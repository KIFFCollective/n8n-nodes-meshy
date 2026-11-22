import { createHash, timingSafeEqual } from 'crypto';
import type { IDataObject } from 'n8n-workflow';
import { isTerminal } from '../Meshy/normalize';

/** Kept in workflow static data between deliveries. Bounded so it cannot grow forever. */
export interface DeliveryState extends IDataObject {
	/** task id -> final status already delivered */
	final: Record<string, string>;
	/** recent "id:status" pairs, oldest first */
	seen: string[];
}

export interface DeliveryFilters {
	/** Task type prefixes to keep, e.g. ["image-to-3d", "text-to-3d"]. Empty keeps all. */
	taskTypes: string[];
	/** Statuses to keep. Empty keeps all. */
	statuses: string[];
}

export type Decision =
	| { accept: true }
	| { accept: false; reason: 'invalid' | 'duplicate' | 'stale' | 'filtered' };

const MAX_SEEN = 500;
const MAX_FINAL = 500;

export function emptyState(): DeliveryState {
	return { final: {}, seen: [] };
}

/**
 * Constant-time secret check. Hashing both sides first gives equal-length buffers,
 * so timingSafeEqual never throws and the length of the secret does not leak.
 */
export function secretMatches(received: unknown, expected: string): boolean {
	if (!expected || typeof received !== 'string' || !received) return false;
	const a = createHash('sha256').update(received).digest();
	const b = createHash('sha256').update(expected).digest();
	return timingSafeEqual(a, b);
}

/**
 * Decides whether a delivery should start the workflow, and records it.
 * Meshy can deliver out of order and more than once, so:
 * - the same id + status pair is handled once
 * - an IN_PROGRESS update that arrives after the final status is dropped
 */
export function decide(
	state: DeliveryState,
	task: IDataObject,
	filters: DeliveryFilters,
): Decision {
	const id = typeof task.id === 'string' ? task.id : '';
	const status = typeof task.status === 'string' ? task.status : '';
	if (!id || !status) return { accept: false, reason: 'invalid' };

	const key = `${id}:${status}`;
	if (state.seen.includes(key)) return { accept: false, reason: 'duplicate' };
	if (!isTerminal(status) && state.final[id]) return { accept: false, reason: 'stale' };

	state.seen.push(key);
	if (state.seen.length > MAX_SEEN) state.seen.splice(0, state.seen.length - MAX_SEEN);
	if (isTerminal(status)) {
		state.final[id] = status;
		const ids = Object.keys(state.final);
		for (const old of ids.slice(0, Math.max(0, ids.length - MAX_FINAL))) delete state.final[old];
	}

	const type = typeof task.type === 'string' ? task.type : '';
	if (
		filters.taskTypes.length &&
		!filters.taskTypes.some((t) => type === t || type.startsWith(`${t}-`))
	) {
		return { accept: false, reason: 'filtered' };
	}
	if (filters.statuses.length && !filters.statuses.includes(status))
		return { accept: false, reason: 'filtered' };
	return { accept: true };
}
