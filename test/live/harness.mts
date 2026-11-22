// A real-network stand-in for n8n's execute context, used only by the opt-in live
// tests. It runs the actual node code against api.meshy.ai with plain fetch.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { Meshy } from '../../nodes/Meshy/Meshy.node.ts';
import { fakeNode } from '../helpers.ts';

export const LIVE = process.env.MESHY_LIVE === '1';
export const MAX_CREDITS = Number(process.env.MESHY_LIVE_MAX_CREDITS ?? 100);

function loadKey(): string {
	if (process.env.MESHY_API_KEY) return process.env.MESHY_API_KEY;
	const envFile = join(import.meta.dirname, '../../.env');
	if (existsSync(envFile)) {
		const match = readFileSync(envFile, 'utf8').match(/^MESHY_API_KEY=(.+)$/m);
		if (match) return match[1].trim();
	}
	return '';
}

const statePath = join(import.meta.dirname, '.state.json');

/** Remembers task ids between runs so a rerun resumes instead of paying again. */
export const state: IDataObject & { spent: number } = existsSync(statePath)
	? JSON.parse(readFileSync(statePath, 'utf8'))
	: { spent: 0 };

export function saveState() {
	writeFileSync(statePath, JSON.stringify(state, null, '\t'));
}

/** Refuses to start a paid task that would take the run over its credit cap. */
export function spend(credits: number, what: string) {
	if (state.spent + credits > MAX_CREDITS) {
		throw new Error(`Live spend cap: ${what} costs ${credits}, already spent ${state.spent} of ${MAX_CREDITS}.`);
	}
	state.spent += credits;
	saveState();
}

interface RequestOptions {
	method?: string;
	url: string;
	qs?: IDataObject;
	body?: unknown;
	headers?: Record<string, string>;
	encoding?: string;
	returnFullResponse?: boolean;
	ignoreHttpStatusErrors?: boolean;
}

async function realRequest(opts: RequestOptions, apiKey?: string) {
	const url = new URL(opts.url);
	for (const [k, v] of Object.entries(opts.qs ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
	const headers: Record<string, string> = { ...(opts.headers ?? {}) };
	if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
	if (opts.body !== undefined) headers['content-type'] = 'application/json';
	const res = await fetch(url, {
		method: opts.method ?? 'GET',
		headers,
		body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
	});
	const resHeaders = Object.fromEntries(res.headers.entries());
	let body: unknown;
	if (opts.encoding === 'arraybuffer') body = Buffer.from(await res.arrayBuffer());
	else {
		const text = await res.text();
		try {
			body = JSON.parse(text);
		} catch {
			body = text;
		}
	}
	if (!opts.ignoreHttpStatusErrors && res.status >= 400) throw new Error(`HTTP ${res.status} from ${url.host}`);
	return opts.returnFullResponse ? { statusCode: res.status, headers: resHeaders, body } : body;
}

/** Runs one Meshy node operation for real and returns its output items. */
export async function runNode(params: IDataObject, input: INodeExecutionData[] = [{ json: {} }]) {
	const apiKey = loadKey();
	if (!apiKey) throw new Error('Set MESHY_API_KEY (or add it to .env) for live tests.');
	const get = (name: string, i: number, ...fallback: unknown[]) => {
		if (name in params) return params[name];
		if (fallback.length) return fallback[0];
		throw new Error(`Missing parameter ${name} for item ${i}`);
	};
	const ctx = {
		getInputData: () => input,
		getNodeParameter: get,
		getNode: () => fakeNode,
		continueOnFail: () => false,
		helpers: {
			httpRequestWithAuthentication: (_cred: string, opts: RequestOptions) => realRequest(opts, apiKey),
			httpRequest: (opts: RequestOptions) => realRequest(opts),
			assertBinaryData: (i: number, prop: string) => {
				const bin = input[i].binary?.[prop];
				if (!bin) throw new Error(`No binary property ${prop}`);
				return bin;
			},
			getBinaryDataBuffer: async (i: number, prop: string) => Buffer.from(input[i].binary![prop].data, 'base64'),
			prepareBinaryData: async (buffer: Buffer, fileName: string, mimeType: string) => ({
				data: buffer.toString('base64'),
				fileName,
				mimeType,
				fileSize: String(buffer.length),
			}),
		},
	} as unknown as IExecuteFunctions;
	const [out] = await new Meshy().execute.call(ctx);
	return out;
}
