import type { IDataObject } from 'n8n-workflow';
import { getFamily, type SourceMode } from './families';
import { bodyFields, type BodyField } from './generated/fields';

/** Images over this size are rejected by Meshy, so fail early with a clear message. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * The small slice of n8n's execute context that body building needs. Keeping it
 * narrow makes the body logic easy to unit test without a full n8n runtime.
 */
export interface ParamReader {
	/** Returns null when the parameter is absent or hidden in the UI. */
	get(name: string): unknown;
	/** Reads an input binary property and returns it as a base64 data URI. */
	binaryToDataUri(propertyName: string, asset: 'image' | 'model'): Promise<string>;
}

export class InputError extends Error {}

export function splitList(value: unknown): string[] {
	if (Array.isArray(value))
		return value
			.map(String)
			.map((s) => s.trim())
			.filter(Boolean);
	if (typeof value !== 'string') return [];
	return value
		.split(/[,\n]/)
		.map((s) => s.trim())
		.filter(Boolean);
}

export function toDataUri(base64: string, mimeType: string): string {
	return `data:${mimeType || 'application/octet-stream'};base64,${base64}`;
}

function convert(field: BodyField, value: unknown, reader: ParamReader): unknown {
	if (value === null || value === undefined) return undefined;
	switch (field.kind) {
		case 'string':
			return value === '' ? undefined : String(value);
		case 'options': {
			if (value === '') return undefined;
			if (field.allowCustom && value === '__custom') {
				const custom = reader.get(
					`custom${field.param.charAt(0).toUpperCase()}${field.param.slice(1)}`,
				);
				return typeof custom === 'string' && custom.trim() ? custom.trim() : undefined;
			}
			return value;
		}
		case 'multiOptions':
			return Array.isArray(value) && value.length ? value : undefined;
		case 'stringList': {
			const list = splitList(value);
			return list.length ? list : undefined;
		}
		case 'numberList': {
			const list = splitList(value);
			if (!list.length) return undefined;
			const numbers = list.map(Number);
			if (numbers.some((n) => !Number.isInteger(n))) {
				throw new InputError(`"${field.param}" must be a comma-separated list of whole numbers.`);
			}
			return numbers;
		}
		case 'object': {
			if (typeof value !== 'object') return undefined;
			const out: IDataObject = {};
			for (const child of field.children ?? []) {
				const v = convert(child, (value as IDataObject)[child.param], reader);
				if (v !== undefined) out[child.api] = v as IDataObject[keyof IDataObject];
			}
			return Object.keys(out).length ? out : undefined;
		}
		default:
			return value;
	}
}

async function applySource(
	familyValue: string,
	body: IDataObject,
	reader: ParamReader,
): Promise<void> {
	const source = getFamily(familyValue).source;
	if (!source) return;
	const mode = (reader.get('inputType') as SourceMode | null) ?? source.modes[0];

	switch (mode) {
		case 'url': {
			const url = String(reader.get('sourceUrl') ?? '').trim();
			if (!url) throw new InputError('Enter a URL for the input.');
			body[source.urlField as string] = url;
			break;
		}
		case 'urls': {
			const urls = splitList(reader.get('sourceUrls'));
			if (!urls.length) throw new InputError('Enter at least one URL.');
			if (source.maxItems && urls.length > source.maxItems) {
				throw new InputError(
					`Meshy accepts at most ${source.maxItems} images here, got ${urls.length}.`,
				);
			}
			body[source.urlsField as string] = urls;
			break;
		}
		case 'binary': {
			const prop = String(reader.get('binaryPropertyName') ?? 'data').trim();
			body[source.urlField as string] = await reader.binaryToDataUri(prop, source.asset);
			break;
		}
		case 'binaries': {
			const props = splitList(reader.get('binaryPropertyNames'));
			if (!props.length) throw new InputError('Enter at least one binary property name.');
			if (source.maxItems && props.length > source.maxItems) {
				throw new InputError(
					`Meshy accepts at most ${source.maxItems} images here, got ${props.length}.`,
				);
			}
			const uris: string[] = [];
			for (const prop of props) uris.push(await reader.binaryToDataUri(prop, source.asset));
			body[source.urlsField as string] = uris;
			break;
		}
		case 'taskId': {
			const id = String(reader.get('inputTaskId') ?? '').trim();
			if (!id) throw new InputError('Enter the ID of the input task.');
			body[source.taskIdField as string] = id;
			break;
		}
	}
}

export async function buildCreateBody(
	familyValue: string,
	reader: ParamReader,
): Promise<IDataObject> {
	const body: IDataObject = {};
	await applySource(familyValue, body, reader);

	const additional = (reader.get('additionalFields') as IDataObject | null) ?? {};
	for (const field of bodyFields[familyValue] ?? []) {
		const raw = field.top ? reader.get(field.param) : additional[field.param];
		const value = convert(field, raw, reader);
		if (value !== undefined) body[field.api] = value as IDataObject[keyof IDataObject];
	}

	// Animation takes exactly one of action_id, action_ids or motion_task_id.
	// action_id is a top-level field with a default, so it gives way to the others.
	if (
		familyValue === 'animation' &&
		(body.action_ids !== undefined || body.motion_task_id !== undefined)
	) {
		delete body.action_id;
	}
	return body;
}
