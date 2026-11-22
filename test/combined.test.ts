import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';
import { Meshy } from '../nodes/Meshy/Meshy.node';
import { loadFixture } from './fixtures';
import { fakeNode } from './helpers';

const GLB = Buffer.from('glTF-fake-bytes');

interface FakeOptions {
	/** Status returned by GET for each task, by task number. Defaults to the fixture (SUCCEEDED). */
	status?: (n: number) => string;
	retryAfter?: string;
	createResponse?: (n: number) => { statusCode: number; body: IDataObject } | undefined;
	failGet?: boolean;
}

/** A fake Meshy API that routes by method and URL, and records every call in order. */
function fakeApi(fixture: IDataObject, opts: FakeOptions = {}) {
	const calls: string[] = [];
	let created = 0;
	const httpRequestWithAuthentication = vi.fn(
		async (_cred: string, req: { method: string; url: string }) => {
			const path = req.url.replace('https://api.meshy.ai/openapi', '');
			calls.push(`${req.method} ${path}`);
			if (req.method === 'POST') {
				const n = created++;
				const custom = opts.createResponse?.(n);
				if (custom) return { ...custom, headers: {} };
				return { statusCode: 202, body: { result: `task-${n}` }, headers: {} };
			}
			if (opts.failGet) return { statusCode: 500, body: { message: 'boom' }, headers: {} };
			const id = path.split('/').pop()!;
			const n = Number(id.split('-')[1]);
			const status = opts.status?.(n) ?? String(fixture.status);
			return {
				statusCode: 200,
				body: { ...fixture, id, status },
				headers: opts.retryAfter ? { 'retry-after': opts.retryAfter } : {},
			};
		},
	);
	const httpRequest = vi.fn(async (req: { url: string }) => {
		calls.push(`DOWNLOAD ${req.url}`);
		return { body: GLB, headers: { 'content-type': 'application/octet-stream' } };
	});
	return { calls, httpRequestWithAuthentication, httpRequest, creates: () => created };
}

function run(
	params: IDataObject,
	api: ReturnType<typeof fakeApi>,
	{ items = 1, continueOnFail = false } = {},
) {
	const input: INodeExecutionData[] = Array.from({ length: items }, (_, n) => ({
		json: { n },
	}));
	const ctx = {
		getInputData: () => input,
		getNode: () => fakeNode,
		continueOnFail: () => continueOnFail,
		getNodeParameter: (name: string, _i: number, ...fallback: unknown[]) => {
			if (name in params) return params[name];
			if (fallback.length) return fallback[0];
			throw new Error(`missing ${name}`);
		},
		helpers: {
			httpRequestWithAuthentication: api.httpRequestWithAuthentication,
			httpRequest: api.httpRequest,
			prepareBinaryData: async (buffer: Buffer, fileName: string, mimeType: string) => ({
				data: buffer.toString('base64'),
				fileName,
				mimeType,
			}),
		},
	} as unknown as IExecuteFunctions;
	return new Meshy().execute.call(ctx).then(([out]) => out);
}

const textTo3d = {
	resource: 'textTo3d',
	operation: 'create',
	mode: 'preview',
	prompt: 'a chair',
	additionalFields: {},
	timeoutMinutes: 10,
	waitOptions: {},
};

describe('Create with Stop After', () => {
	it('Task Created (default) is unchanged: one POST, id returned', async () => {
		const api = fakeApi(loadFixture('text-to-3d', 'get'));
		// textTo3d has no stopAfter, like a workflow saved before 0.2.0.
		const out = await run(textTo3d, api);
		expect(out).toEqual([
			{ json: { id: 'task-0', status: 'PENDING', family: 'textTo3d' }, pairedItem: { item: 0 } },
		]);
		expect(api.calls).toEqual(['POST /v2/text-to-3d']);
	});

	it('Task Finished returns the same task as Create followed by Wait', async () => {
		const fixture = loadFixture('text-to-3d', 'get');
		const combined = await run({ ...textTo3d, stopAfter: 'finished' }, fakeApi(fixture));

		const api = fakeApi(fixture);
		const [created] = await run(textTo3d, api);
		const waited = await run(
			{
				resource: 'textTo3d',
				operation: 'wait',
				taskId: created.json.id,
				timeoutMinutes: 10,
				waitOptions: {},
			},
			api,
		);
		expect(combined).toEqual(waited);
		expect(combined[0].json.model_urls).toBeDefined();
	});

	it('File Downloaded returns the same file as Create, Wait, Download', async () => {
		const fixture = loadFixture('text-to-3d', 'get');
		const params = {
			...textTo3d,
			format: 'glb',
			binaryPropertyOutput: 'data',
			downloadOptions: {},
		};
		const [combined] = await run({ ...params, stopAfter: 'downloaded' }, fakeApi(fixture));

		const api = fakeApi(fixture);
		const [created] = await run(textTo3d, api);
		const [downloaded] = await run(
			{ ...params, operation: 'download', downloadSource: 'taskId', taskId: created.json.id },
			api,
		);
		expect(combined.binary?.data).toEqual(downloaded.binary?.data);
		expect(combined.binary?.data.mimeType).toBe('model/gltf-binary');
		expect(combined.json).toEqual(downloaded.json);
	});

	it('creates all 10 tasks before the first poll', async () => {
		const api = fakeApi(loadFixture('text-to-3d', 'get'));
		const out = await run({ ...textTo3d, stopAfter: 'finished' }, api, { items: 10 });
		expect(out).toHaveLength(10);
		const firstGet = api.calls.findIndex((c) => c.startsWith('GET'));
		expect(firstGet).toBe(10);
		expect(api.calls.slice(0, 10).every((c) => c.startsWith('POST'))).toBe(true);
		expect(out.map((o) => o.pairedItem)).toEqual(
			Array.from({ length: 10 }, (_, item) => ({ item })),
		);
	});

	it('times out with the task ID and does not create again', async () => {
		const api = fakeApi(loadFixture('text-to-3d', 'get'), {
			status: () => 'IN_PROGRESS',
			retryAfter: '120',
		});
		await expect(
			run({ ...textTo3d, stopAfter: 'finished', timeoutMinutes: 1 }, api),
		).rejects.toThrow(/task-0 is still IN_PROGRESS/);
		expect(api.creates()).toBe(1);
	});

	it('returns the pending task on timeout when asked', async () => {
		const api = fakeApi(loadFixture('text-to-3d', 'get'), {
			status: () => 'IN_PROGRESS',
			retryAfter: '120',
		});
		const [item] = await run(
			{
				...textTo3d,
				stopAfter: 'downloaded',
				timeoutMinutes: 1,
				waitOptions: { returnTaskOnTimeout: true },
			},
			api,
		);
		expect(item.json).toMatchObject({ id: 'task-0', status: 'IN_PROGRESS' });
		expect(item.binary).toBeUndefined();
		expect(api.creates()).toBe(1);
	});

	it('returns a FAILED task with no download when Error on Failed Task is off', async () => {
		const api = fakeApi(loadFixture('text-to-3d', 'get'), { status: () => 'FAILED' });
		const [item] = await run(
			{ ...textTo3d, stopAfter: 'downloaded', waitOptions: { failOnTaskError: false } },
			api,
		);
		expect(item.json.status).toBe('FAILED');
		expect(item.binary).toBeUndefined();
		expect(api.httpRequest).not.toHaveBeenCalled();
	});

	it('lists every created task ID when a task fails', async () => {
		const api = fakeApi(loadFixture('text-to-3d', 'get'), {
			status: (n) => (n === 1 ? 'FAILED' : 'SUCCEEDED'),
		});
		const error = await run({ ...textTo3d, stopAfter: 'finished' }, api, { items: 3 }).catch(
			(e: Error & { description?: string }) => e,
		);
		expect((error as Error).message).toMatch(/task-1 ended as FAILED/);
		const description = (error as { description?: string }).description ?? '';
		for (const id of ['task-0', 'task-1', 'task-2']) expect(description).toContain(id);
		expect(api.creates()).toBe(3);
	});

	it('never creates twice after poll errors (5xx)', async () => {
		vi.useFakeTimers();
		try {
			const api = fakeApi(loadFixture('text-to-3d', 'get'), { failGet: true });
			const pending = run({ ...textTo3d, stopAfter: 'finished' }, api, { items: 2 }).catch(
				(e: Error & { description?: string }) => e,
			);
			await vi.runAllTimersAsync();
			const error = (await pending) as Error & { description?: string };
			expect(error.message).toMatch(/server error/);
			expect(api.creates()).toBe(2);
			expect(error.description).toContain('task-0');
			expect(error.description).toContain('task-1');
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not retry a create that got a 5xx, and lists earlier tasks', async () => {
		const api = fakeApi(loadFixture('text-to-3d', 'get'), {
			createResponse: (n) => (n === 1 ? { statusCode: 500, body: { message: 'oops' } } : undefined),
		});
		const error = (await run({ ...textTo3d, stopAfter: 'finished' }, api, { items: 3 }).catch(
			(e) => e,
		)) as Error & { description?: string };
		expect(error.message).toMatch(/server error/);
		expect(error.description).toContain('task-0');
		expect(api.creates()).toBe(2); // item 3 is never created
	});

	it('checks every input before creating anything', async () => {
		const api = fakeApi(loadFixture('text-to-3d', 'get'));
		await expect(
			run(
				{
					resource: 'task',
					operation: 'create',
					taskType: 'textTo3d',
					requestBody: '[1]',
					stopAfter: 'finished',
				},
				api,
				{ items: 2 },
			),
		).rejects.toThrow(/JSON object/);
		expect(api.creates()).toBe(0);
	});

	it('with Continue On Fail, returns per-item errors with the task ID', async () => {
		const api = fakeApi(loadFixture('text-to-3d', 'get'), {
			status: (n) => (n === 0 ? 'FAILED' : 'SUCCEEDED'),
		});
		const out = await run({ ...textTo3d, stopAfter: 'finished' }, api, {
			items: 2,
			continueOnFail: true,
		});
		expect(out[0].json).toMatchObject({ id: 'task-0', error: expect.stringMatching(/FAILED/) });
		expect(out[1].json).toMatchObject({ id: 'task-1', status: 'SUCCEEDED' });
	});

	it('queues creates when Meshy reports the task slot limit', async () => {
		const api = fakeApi(loadFixture('text-to-3d', 'get'), {
			createResponse: (n) =>
				n === 1 ? { statusCode: 429, body: { message: 'NoMorePendingTasks' } } : undefined,
		});
		const out = await run({ ...textTo3d, stopAfter: 'finished' }, api, { items: 2 });
		expect(out.map((o) => o.json.id)).toEqual(['task-0', 'task-2']);
		expect(api.calls).toEqual([
			'POST /v2/text-to-3d',
			'POST /v2/text-to-3d',
			'GET /v2/text-to-3d/task-0',
			'POST /v2/text-to-3d',
			'GET /v2/text-to-3d/task-2',
		]);
	});

	it('defaults the format to Image for image families', async () => {
		const { description } = new Meshy();
		const formats = description.properties.filter(
			(p) => p.name === 'format' && p.displayOptions?.show?.operation?.includes('create'),
		);
		const forResource = (r: string) =>
			formats.find((p) => (p.displayOptions?.show?.resource as string[]).includes(r))?.default;
		expect(forResource('textToImage')).toBe('image');
		expect(forResource('imageToImage')).toBe('image');
		expect(forResource('imageTo3d')).toBe('glb');
		expect(forResource('task')).toBe('glb');
	});
});
