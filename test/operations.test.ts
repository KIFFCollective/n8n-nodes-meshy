import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';
import { runOperation } from '../nodes/Meshy/operations';
import { fakeContext, type FakeResponse } from './helpers';
import { loadFixture } from './fixtures';

/** Builds an execute context with parameters and queued HTTP responses. */
function ctxWith(params: IDataObject, responses: FakeResponse[]) {
	const { ctx, httpRequestWithAuthentication } = fakeContext(responses);
	const full = {
		...ctx,
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name: string, _i: number, ...fallback: unknown[]) => {
			if (name in params) return params[name];
			if (fallback.length) return fallback[0];
			throw new Error(`missing ${name}`);
		},
	} as unknown as IExecuteFunctions;
	return { ctx: full, httpRequestWithAuthentication };
}

describe('runOperation', () => {
	it('Create returns the id immediately and sends one POST', async () => {
		const { ctx, httpRequestWithAuthentication } = ctxWith(
			{ inputType: 'taskId', inputTaskId: 'abc', additionalFields: {} },
			[{ statusCode: 202, body: { result: 'new-task' } }],
		);
		const [item] = await runOperation(ctx, 'remesh', 'create', 0);
		expect(item.json).toEqual({ id: 'new-task', status: 'PENDING', family: 'remesh' });
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'meshyApi',
			expect.objectContaining({
				method: 'POST',
				url: 'https://api.meshy.ai/openapi/v1/remesh',
				body: { input_task_id: 'abc' },
			}),
		);
	});

	it('Any Task Type creates with a raw JSON body on the chosen family path', async () => {
		const { ctx, httpRequestWithAuthentication } = ctxWith(
			{ taskType: 'textTo3d', requestBody: '{"mode":"preview","prompt":"a chair"}' },
			[{ statusCode: 202, body: { result: 't1' } }],
		);
		const [item] = await runOperation(ctx, 'task', 'create', 0);
		expect(item.json).toMatchObject({ id: 't1', family: 'textTo3d' });
		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'meshyApi',
			expect.objectContaining({
				url: 'https://api.meshy.ai/openapi/v2/text-to-3d',
				body: { mode: 'preview', prompt: 'a chair' },
			}),
		);
	});

	it('Any Task Type rejects a body that is not a JSON object', async () => {
		const { ctx } = ctxWith({ taskType: 'remesh', requestBody: '[1,2]' }, []);
		await expect(runOperation(ctx, 'task', 'create', 0)).rejects.toThrow(/JSON object/);
	});

	it('Get returns the normalised task', async () => {
		const { ctx } = ctxWith({ taskId: 'x' }, [
			{ statusCode: 200, body: loadFixture('rigging', 'get') },
		]);
		const [item] = await runOperation(ctx, 'rigging', 'get', 0);
		expect(item.json).toMatchObject({ family: 'rigging', status: 'SUCCEEDED' });
		expect(item.json.model_urls).toHaveProperty('fbx');
	});

	it('Get Many pages until the limit', async () => {
		const page = Array.from({ length: 100 }, (_, n) => ({
			id: `t${n}`,
			status: 'SUCCEEDED',
			created_at: 1,
		}));
		const { ctx, httpRequestWithAuthentication } = ctxWith(
			{ returnAll: false, limit: 150, sortBy: '-created_at' },
			[
				{ statusCode: 200, body: page },
				{ statusCode: 200, body: page.slice(0, 50) },
			],
		);
		const items = await runOperation(ctx, 'imageTo3d', 'getAll', 0);
		expect(items).toHaveLength(150);
		expect(httpRequestWithAuthentication).toHaveBeenNthCalledWith(
			2,
			'meshyApi',
			expect.objectContaining({ qs: { sort_by: '-created_at', page_num: 2, page_size: 50 } }),
		);
	});

	it('Cancel on a running task explains the 409', async () => {
		const { ctx } = ctxWith({ taskId: 'x' }, [
			{ statusCode: 409, body: { message: 'Task is in progress' } },
		]);
		await expect(runOperation(ctx, 'remesh', 'cancel', 0)).rejects.toThrow(
			/Only PENDING tasks can be canceled/,
		);
	});

	it('Wait reports a failed task as an error with the Meshy message', async () => {
		const failed = { id: 'x', status: 'FAILED', task_error: { message: 'Pose estimation failed' } };
		const { ctx } = ctxWith({ taskId: 'x', timeoutMinutes: 10, waitOptions: {} }, [
			{ statusCode: 200, body: failed },
		]);
		await expect(runOperation(ctx, 'rigging', 'wait', 0)).rejects.toThrow(
			/ended as FAILED: Pose estimation failed/,
		);
	});

	it('Wait can return a failed task as output instead', async () => {
		const failed = { id: 'x', status: 'FAILED', task_error: { message: 'nope' } };
		const { ctx } = ctxWith(
			{ taskId: 'x', timeoutMinutes: 10, waitOptions: { failOnTaskError: false } },
			[{ statusCode: 200, body: failed }],
		);
		const [item] = await runOperation(ctx, 'rigging', 'wait', 0);
		expect(item.json).toMatchObject({ status: 'FAILED', error: { message: 'nope' } });
	});
});

describe('Task ID guard', () => {
	it.each(['get', 'cancel', 'wait'])(
		'%s refuses an empty Task ID instead of hitting the list endpoint',
		async (op) => {
			const { ctx, httpRequestWithAuthentication } = ctxWith(
				{ taskId: '  ', timeoutMinutes: 10, waitOptions: {} },
				[],
			);
			await expect(runOperation(ctx, 'remesh', op, 0)).rejects.toThrow(/Task ID is empty/);
			expect(httpRequestWithAuthentication).not.toHaveBeenCalled();
		},
	);
});
