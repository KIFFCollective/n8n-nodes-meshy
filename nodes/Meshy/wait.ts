import type { IDataObject } from 'n8n-workflow';
import { isTerminal } from './normalize';
import { DEFAULT_RETRY_AFTER_SECONDS } from './transport';

export const DEFAULT_WAIT_MINUTES = 10;
/** Meshy says not to give up before 60 minutes; we cap well below that and say the task is still running. */
export const MAX_WAIT_MINUTES = 50;

export interface PollResult {
	task: IDataObject;
	retryAfterSeconds?: number;
}

export interface PollOptions {
	timeoutMs: number;
	sleep: (ms: number) => Promise<void>;
	now?: () => number;
}

/** Thrown when our timeout runs out. The task itself is still running on Meshy. */
export class WaitTimeoutError extends Error {
	constructor(
		readonly taskId: string,
		readonly lastStatus: string,
		readonly waitedMs: number,
	) {
		super(
			`Stopped waiting after ${Math.round(waitedMs / 1000)} seconds. Task ${taskId} is still ${lastStatus} on Meshy and has not failed. Use Get or Wait again later with this ID.`,
		);
		this.name = 'WaitTimeoutError';
	}
}

/**
 * Polls until the task reaches SUCCEEDED, FAILED or CANCELED.
 * A task can move from IN_PROGRESS back to PENDING with the same ID; that is
 * normal on Meshy's side, so only terminal statuses end the loop.
 */
export async function pollUntilTerminal(
	taskId: string,
	fetchTask: () => Promise<PollResult>,
	options: PollOptions,
): Promise<IDataObject> {
	const now = options.now ?? Date.now;
	const started = now();
	for (;;) {
		const { task, retryAfterSeconds } = await fetchTask();
		const status = String(task.status ?? '');
		if (isTerminal(status)) return task;

		const delayMs = (retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS) * 1000;
		const elapsed = now() - started;
		if (elapsed + delayMs > options.timeoutMs) {
			throw new WaitTimeoutError(taskId, status || 'UNKNOWN', elapsed);
		}
		await options.sleep(delayMs);
	}
}
