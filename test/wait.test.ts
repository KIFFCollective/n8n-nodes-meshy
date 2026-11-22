import { describe, expect, it, vi } from 'vitest';
import { pollUntilTerminal, WaitTimeoutError, type PollResult } from '../nodes/Meshy/wait';

/** A fake clock that moves forward whenever the poller sleeps. */
function fakeClock() {
	let now = 0;
	const sleep = vi.fn(async (ms: number) => {
		now += ms;
	});
	return { sleep, now: () => now };
}

function sequence(results: PollResult[]) {
	let i = 0;
	return vi.fn(async () => results[Math.min(i++, results.length - 1)]);
}

describe('pollUntilTerminal', () => {
	it('keeps polling when a task goes from IN_PROGRESS back to PENDING', async () => {
		const clock = fakeClock();
		const fetch = sequence([
			{ task: { id: 't', status: 'PENDING' } },
			{ task: { id: 't', status: 'IN_PROGRESS', progress: 40 } },
			{ task: { id: 't', status: 'PENDING' } },
			{ task: { id: 't', status: 'SUCCEEDED', progress: 100 } },
		]);
		const task = await pollUntilTerminal('t', fetch, { timeoutMs: 600_000, ...clock });
		expect(task.status).toBe('SUCCEEDED');
		expect(fetch).toHaveBeenCalledTimes(4);
	});

	it.each(['SUCCEEDED', 'FAILED', 'CANCELED'])('stops on terminal status %s', async (status) => {
		const clock = fakeClock();
		const task = await pollUntilTerminal('t', sequence([{ task: { id: 't', status } }]), {
			timeoutMs: 60_000,
			...clock,
		});
		expect(task.status).toBe(status);
		expect(clock.sleep).not.toHaveBeenCalled();
	});

	it('waits the Retry-After value between polls', async () => {
		const clock = fakeClock();
		const fetch = sequence([
			{ task: { status: 'IN_PROGRESS' }, retryAfterSeconds: 12 },
			{ task: { status: 'SUCCEEDED' } },
		]);
		await pollUntilTerminal('t', fetch, { timeoutMs: 600_000, ...clock });
		expect(clock.sleep).toHaveBeenCalledWith(12_000);
	});

	it('waits 5 seconds when Retry-After is absent', async () => {
		const clock = fakeClock();
		const fetch = sequence([{ task: { status: 'PENDING' } }, { task: { status: 'SUCCEEDED' } }]);
		await pollUntilTerminal('t', fetch, { timeoutMs: 600_000, ...clock });
		expect(clock.sleep).toHaveBeenCalledWith(5_000);
	});

	it('times out with an error that says the task is still running and shows its id', async () => {
		const clock = fakeClock();
		const fetch = sequence([{ task: { status: 'IN_PROGRESS' }, retryAfterSeconds: 30 }]);
		const error = await pollUntilTerminal('task-123', fetch, {
			timeoutMs: 120_000,
			...clock,
		}).catch((e) => e);
		expect(error).toBeInstanceOf(WaitTimeoutError);
		expect(error.message).toContain('task-123');
		expect(error.message).toContain('still IN_PROGRESS');
		expect(error.message).toContain('has not failed');
		// 30s waits: polls at 0, 30, 60, 90 and 120; the next wait would pass the 120s limit.
		expect(fetch).toHaveBeenCalledTimes(5);
	});
});
