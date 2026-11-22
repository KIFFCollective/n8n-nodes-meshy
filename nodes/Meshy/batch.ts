// Runs several Meshy tasks side by side: create them all, then poll them all.
// Kept free of n8n types (apart from IDataObject) so the scheduling can be tested
// with a fake clock.
import type { IDataObject } from 'n8n-workflow';
import { isTerminal } from './normalize';
import { DEFAULT_RETRY_AFTER_SECONDS } from './transport';
import { WaitTimeoutError, type PollResult } from './wait';

/** Polls that may fail in a row for one task before that task counts as failed. */
export const MAX_POLL_ERRORS = 3;

export type BatchOutcome =
	| { kind: 'done'; taskId: string; task: IDataObject }
	| { kind: 'timeout'; taskId: string; error: WaitTimeoutError }
	| { kind: 'notStarted'; error: NotStartedError }
	| { kind: 'error'; taskId?: string; error: unknown };

export interface CreatedTask {
	job: number;
	taskId: string;
	status: string;
}

/** Why a run stopped early. Every task created so far is listed, so no ID is lost. */
export interface BatchAbort {
	cause: unknown;
	/** The job that failed, or undefined when the run itself stopped (for example, canceled). */
	job?: number;
	created: CreatedTask[];
}

export interface BatchResult {
	outcomes: BatchOutcome[];
	abort?: BatchAbort;
}

type Attempt<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function attempt<T>(fn: () => Promise<T>): Promise<Attempt<T>> {
	try {
		return { ok: true, value: await fn() };
	} catch (error) {
		return { ok: false, error };
	}
}

/** A queued job that never got a free slot before the timeout. No task exists for it. */
export class NotStartedError extends Error {
	constructor() {
		super(
			'The task was not created before the timeout, because your Meshy plan was already running as many tasks as it allows. No credits were charged for it.',
		);
		this.name = 'NotStartedError';
	}
}

export interface BatchOptions {
	/** Number of jobs. Jobs are numbered 0 to count - 1. */
	count: number;
	/** Creates the task for a job and returns its ID. Called at most once per job unless it throws a pending-limit error. */
	create: (job: number) => Promise<string>;
	fetch: (job: number, taskId: string) => Promise<PollResult>;
	/** True for the error Meshy returns before creating anything when the plan's task slots are full. */
	isPendingLimit: (error: unknown) => boolean;
	/** Stop at the first error and return it as `abort`, instead of recording it and carrying on. */
	stopOnError: boolean;
	/** One deadline for the whole run, creates included. */
	timeoutMs: number;
	sleep: (ms: number) => Promise<void>;
	now?: () => number;
}

/**
 * Creates every job's task, then polls all running tasks in rounds until each one
 * reaches a final status. When Meshy refuses a create because the plan's task slots
 * are full, the job waits in a queue and is created when a slot frees up. That
 * refusal happens before any task exists, so it is the only create error retried.
 */
export async function runBatch(options: BatchOptions): Promise<BatchResult> {
	const now = options.now ?? Date.now;
	const started = now();
	const outcomes: BatchOutcome[] = new Array(options.count);
	const queue = Array.from({ length: options.count }, (_, job) => job);
	const running = new Map<
		number,
		{ taskId: string; status: string; errors: number; task?: IDataObject }
	>();
	const created: CreatedTask[] = [];
	const stop = (cause: unknown, job?: number): BatchResult => ({
		outcomes,
		abort: { cause, job, created },
	});

	// True after Meshy refused a create for lack of slots. While our own tasks hold
	// those slots, retry only after one of them finishes.
	let limited = false;
	let freed = false;
	for (;;) {
		// Create as many queued jobs as Meshy accepts.
		const tryCreate = !limited || freed || !running.size;
		if (tryCreate) limited = false;
		while (tryCreate && queue.length) {
			const job = queue[0];
			const res = await attempt(() => options.create(job));
			if (!res.ok) {
				if (options.isPendingLimit(res.error)) {
					limited = true;
					break;
				}
				queue.shift();
				if (options.stopOnError) return stop(res.error, job);
				outcomes[job] = { kind: 'error', error: res.error };
				continue;
			}
			queue.shift();
			running.set(job, { taskId: res.value, status: 'PENDING', errors: 0 });
			created.push({ job, taskId: res.value, status: 'PENDING' });
		}
		if (!running.size && !queue.length) break;

		// Poll every running task once.
		let delayMs: number | undefined;
		freed = false;
		for (const [job, entry] of running) {
			const res = await attempt(() => options.fetch(job, entry.taskId));
			if (!res.ok) {
				entry.errors++;
				if (entry.errors >= MAX_POLL_ERRORS) {
					if (options.stopOnError) return stop(res.error, job);
					running.delete(job);
					freed = true;
					outcomes[job] = { kind: 'error', taskId: entry.taskId, error: res.error };
				}
				continue;
			}
			const result = res.value;
			entry.errors = 0;
			entry.task = result.task;
			entry.status = String(result.task.status ?? '') || 'UNKNOWN';
			const record = created.find((c) => c.job === job);
			if (record) record.status = entry.status;
			if (isTerminal(entry.status)) {
				running.delete(job);
				freed = true;
				outcomes[job] = { kind: 'done', taskId: entry.taskId, task: result.task };
			} else {
				const ms = (result.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS) * 1000;
				delayMs = delayMs === undefined ? ms : Math.min(delayMs, ms);
			}
		}
		if (!running.size && !queue.length) break;
		// A slot just freed up: try the queue again before sleeping.
		if (freed && queue.length) continue;

		const wait = delayMs ?? DEFAULT_RETRY_AFTER_SECONDS * 1000;
		const elapsed = now() - started;
		if (elapsed + wait > options.timeoutMs) {
			for (const [job, entry] of running) {
				outcomes[job] = {
					kind: 'timeout',
					taskId: entry.taskId,
					error: new WaitTimeoutError(entry.taskId, entry.status, elapsed, entry.task),
				};
			}
			for (const job of queue) outcomes[job] = { kind: 'notStarted', error: new NotStartedError() };
			break;
		}
		const slept = await attempt(() => options.sleep(wait));
		if (!slept.ok) return stop(slept.error);
	}
	return { outcomes };
}
