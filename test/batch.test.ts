import type { IDataObject } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';
import { MAX_POLL_ERRORS, runBatch, type BatchOptions } from '../nodes/Meshy/batch';
import { WaitTimeoutError } from '../nodes/Meshy/wait';

class LimitError extends Error {}

/**
 * A fake Meshy with a task-slot limit. Each task needs `pollsToFinish` polls to
 * succeed. Records every call in order so tests can check the sequence.
 */
function fakeMeshy({ slots = Infinity, pollsToFinish = 1, retryAfter = 5 } = {}) {
	let now = 0;
	const log: string[] = [];
	const polls = new Map<string, number>();
	const finished = new Set<string>();
	let next = 0;
	const running = () => [...polls.keys()].filter((id) => !finished.has(id)).length;
	const options: BatchOptions = {
		count: 0,
		create: vi.fn(async (job: number) => {
			if (running() >= slots) {
				log.push(`limit ${job}`);
				throw new LimitError('NoMorePendingTasks');
			}
			const id = `t${next++}`;
			polls.set(id, 0);
			log.push(`create ${job}`);
			return id;
		}),
		fetch: vi.fn(async (_job: number, id: string) => {
			const count = (polls.get(id) ?? 0) + 1;
			polls.set(id, count);
			log.push(`poll ${id}`);
			const done = count >= pollsToFinish;
			if (done) finished.add(id);
			const task: IDataObject = { id, status: done ? 'SUCCEEDED' : 'IN_PROGRESS' };
			return { task, retryAfterSeconds: retryAfter };
		}),
		isPendingLimit: (error) => error instanceof LimitError,
		stopOnError: true,
		timeoutMs: 600_000,
		sleep: vi.fn(async (ms: number) => {
			now += ms;
		}),
		now: () => now,
	};
	return { options, log, clock: () => now };
}

describe('runBatch', () => {
	it('creates all 10 tasks before the first poll', async () => {
		const { options, log } = fakeMeshy({ pollsToFinish: 3 });
		const { outcomes, abort } = await runBatch({ ...options, count: 10 });
		expect(abort).toBeUndefined();
		const firstPoll = log.findIndex((l) => l.startsWith('poll'));
		expect(log.slice(0, firstPoll)).toEqual(Array.from({ length: 10 }, (_, n) => `create ${n}`));
		expect(outcomes.every((o) => o.kind === 'done')).toBe(true);
		expect(options.create).toHaveBeenCalledTimes(10);
	});

	it('takes about as long as one task, not the sum', async () => {
		const { options, clock } = fakeMeshy({ pollsToFinish: 3, retryAfter: 5 });
		await runBatch({ ...options, count: 10 });
		// Three poll rounds, two sleeps of 5 seconds between them.
		expect(clock()).toBe(10_000);
	});

	it('queues creates when the plan has no free task slot, and never double-creates', async () => {
		const { options, log } = fakeMeshy({ slots: 2, pollsToFinish: 2 });
		const { outcomes, abort } = await runBatch({ ...options, count: 5 });
		expect(abort).toBeUndefined();
		expect(outcomes.map((o) => o.kind)).toEqual(['done', 'done', 'done', 'done', 'done']);
		const successfulCreates = log.filter((l) => l.startsWith('create'));
		expect(successfulCreates).toEqual(['create 0', 'create 1', 'create 2', 'create 3', 'create 4']);
		// No more than 2 tasks were ever running.
		expect(log).toContain('limit 2');
	});

	it('marks queued jobs as not started when the timeout runs out', async () => {
		const { options } = fakeMeshy({ slots: 1, pollsToFinish: 1000 });
		const { outcomes } = await runBatch({ ...options, count: 2, timeoutMs: 60_000 });
		expect(outcomes[0].kind).toBe('timeout');
		expect(outcomes[1].kind).toBe('notStarted');
		// One success, one refusal. The queued job is not retried while our own task holds the slot.
		expect(options.create).toHaveBeenCalledTimes(2);
	});

	it('times out with the task ID and its last task, without creating again', async () => {
		const { options } = fakeMeshy({ pollsToFinish: 1000 });
		const { outcomes } = await runBatch({ ...options, count: 1, timeoutMs: 60_000 });
		const outcome = outcomes[0];
		expect(outcome.kind).toBe('timeout');
		if (outcome.kind !== 'timeout') return;
		expect(outcome.error).toBeInstanceOf(WaitTimeoutError);
		expect(outcome.error.message).toContain('t0');
		expect(outcome.error.lastTask).toMatchObject({ id: 't0', status: 'IN_PROGRESS' });
		expect(options.create).toHaveBeenCalledTimes(1);
	});

	it('tolerates a few poll errors in a row without creating again', async () => {
		const { options } = fakeMeshy();
		const real = options.fetch;
		let calls = 0;
		options.fetch = vi.fn(async (job, id) => {
			if (++calls < MAX_POLL_ERRORS) throw new Error('HTTP 502');
			return real(job, id);
		});
		const { outcomes, abort } = await runBatch({ ...options, count: 1 });
		expect(abort).toBeUndefined();
		expect(outcomes[0].kind).toBe('done');
		expect(options.create).toHaveBeenCalledTimes(1);
	});

	it('stops at the first create error and lists the tasks created so far', async () => {
		const { options } = fakeMeshy({ pollsToFinish: 2 });
		const real = options.create;
		options.create = vi.fn(async (job: number) => {
			if (job === 2) throw new Error('HTTP 500');
			return real(job);
		});
		const { abort } = await runBatch({ ...options, count: 4 });
		expect(abort?.job).toBe(2);
		expect(abort?.created.map((c) => c.taskId)).toEqual(['t0', 't1']);
		expect(options.create).toHaveBeenCalledTimes(3); // job 3 is never created
	});

	it('stops after repeated poll errors and lists every task', async () => {
		const { options } = fakeMeshy();
		options.fetch = vi.fn(async () => {
			throw new Error('HTTP 500');
		});
		const { abort } = await runBatch({ ...options, count: 2 });
		expect(abort?.created.map((c) => c.taskId)).toEqual(['t0', 't1']);
		expect(options.create).toHaveBeenCalledTimes(2);
	});

	it('records errors per job and carries on when not stopping on error', async () => {
		const { options } = fakeMeshy();
		const real = options.create;
		options.create = vi.fn(async (job: number) => {
			if (job === 0) throw new Error('HTTP 402');
			return real(job);
		});
		const { outcomes, abort } = await runBatch({ ...options, count: 2, stopOnError: false });
		expect(abort).toBeUndefined();
		expect(outcomes.map((o) => o.kind)).toEqual(['error', 'done']);
	});

	it('reports a canceled execution as an abort with the created tasks', async () => {
		const { options } = fakeMeshy({ pollsToFinish: 5 });
		options.sleep = vi.fn(async () => {
			throw new Error('The execution was canceled');
		});
		const { abort } = await runBatch({ ...options, count: 1 });
		expect(abort?.job).toBeUndefined();
		expect(abort?.created.map((c) => c.taskId)).toEqual(['t0']);
	});
});
