import type { IDataObject } from 'n8n-workflow';
import type { OutputKind } from './families';

export const TERMINAL_STATUSES = ['SUCCEEDED', 'FAILED', 'CANCELED'];

export interface TaskError {
	message: string;
	code?: string;
	type?: string;
}

export interface NormalizedTask extends IDataObject {
	id: string;
	family: string;
	status: string;
	progress: number;
	name: string | null;
	model_urls: Record<string, string>;
	thumbnail_url: string | null;
	texture_urls: IDataObject[];
	image_urls?: string[];
	error: TaskError | null;
	created_at: string | null;
	finished_at: string | null;
	raw: IDataObject;
}

/** Epoch milliseconds to ISO. Meshy uses 0 for "not yet", which becomes null. */
export function toIso(value: unknown): string | null {
	const ms = Number(value);
	if (!Number.isFinite(ms) || ms <= 0) return null;
	return new Date(ms).toISOString();
}

const asString = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function stringRecord(value: unknown): Record<string, string> {
	const out: Record<string, string> = {};
	if (!value || typeof value !== 'object') return out;
	for (const [key, url] of Object.entries(value as Record<string, unknown>)) {
		if (typeof url === 'string' && url !== '') out[key] = url;
	}
	return out;
}

/**
 * Rigging and animation tasks put their files under `result` with long key names.
 * Map them to the same `model_urls` shape as other families so Download works
 * the same way everywhere. The original stays in `raw`.
 */
function modelUrlsFor(raw: IDataObject, output: OutputKind): Record<string, string> {
	const result = (raw.result ?? {}) as Record<string, unknown>;
	if (output === 'rig') {
		return stringRecord({
			glb: result.rigged_character_glb_url,
			fbx: result.rigged_character_fbx_url,
		});
	}
	if (output === 'animation') {
		return stringRecord({
			glb: result.animation_glb_url,
			fbx: result.animation_fbx_url,
			usdz: result.processed_usdz_url,
		});
	}
	return stringRecord(raw.model_urls);
}

function taskError(raw: IDataObject): TaskError | null {
	const err = raw.task_error as IDataObject | null | undefined;
	if (!err || typeof err !== 'object' || !err.message) return null;
	const out: TaskError = { message: String(err.message) };
	if (err.code) out.code = String(err.code);
	if (err.type) out.type = String(err.type);
	return out;
}

export function normalizeTask(
	raw: IDataObject,
	family: string,
	output: OutputKind,
): NormalizedTask {
	const task: NormalizedTask = {
		id: String(raw.id ?? ''),
		family,
		status: String(raw.status ?? ''),
		progress: Number(raw.progress ?? 0),
		name: asString(raw.name),
		model_urls: modelUrlsFor(raw, output),
		thumbnail_url: asString(raw.thumbnail_url),
		texture_urls: Array.isArray(raw.texture_urls) ? (raw.texture_urls as IDataObject[]) : [],
		error: taskError(raw),
		created_at: toIso(raw.created_at),
		finished_at: toIso(raw.finished_at),
		raw,
	};
	if (output === 'image') {
		task.image_urls = Array.isArray(raw.image_urls)
			? (raw.image_urls as unknown[]).filter((u): u is string => typeof u === 'string')
			: [];
	}
	return task;
}

export function isTerminal(status: string): boolean {
	return TERMINAL_STATUSES.includes(status);
}
