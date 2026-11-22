import type { IDataObject, IWebhookFunctions } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';
import {
	decide,
	emptyState,
	secretMatches,
	type DeliveryFilters,
} from '../nodes/MeshyTrigger/delivery';
import { MeshyTrigger } from '../nodes/MeshyTrigger/MeshyTrigger.node';
import { fakeNode } from './helpers';

const all: DeliveryFilters = { taskTypes: [], statuses: [] };
const task = (id: string, status: string, type = 'image-to-3d'): IDataObject => ({
	id,
	status,
	type,
	progress: 50,
});

describe('secretMatches', () => {
	it('accepts the exact secret and rejects anything else', () => {
		expect(secretMatches('s3cret', 's3cret')).toBe(true);
		expect(secretMatches('s3cret ', 's3cret')).toBe(false);
		expect(secretMatches('short', 'a-much-longer-secret')).toBe(false);
		expect(secretMatches(undefined, 's3cret')).toBe(false);
		expect(secretMatches(['s3cret'], 's3cret')).toBe(false);
	});

	it('rejects everything when no secret is configured', () => {
		expect(secretMatches('', '')).toBe(false);
		expect(secretMatches('anything', '')).toBe(false);
	});
});

describe('decide', () => {
	it('accepts a normal progress then final sequence', () => {
		const state = emptyState();
		expect(decide(state, task('a', 'IN_PROGRESS'), all)).toEqual({ accept: true });
		expect(decide(state, task('a', 'SUCCEEDED'), all)).toEqual({ accept: true });
	});

	it('drops duplicate deliveries of the same id and status', () => {
		const state = emptyState();
		decide(state, task('a', 'SUCCEEDED'), all);
		expect(decide(state, task('a', 'SUCCEEDED'), all)).toEqual({
			accept: false,
			reason: 'duplicate',
		});
	});

	it('drops a stale IN_PROGRESS that arrives after the final status', () => {
		const state = emptyState();
		decide(state, task('a', 'SUCCEEDED'), all);
		expect(decide(state, task('a', 'IN_PROGRESS'), all)).toEqual({
			accept: false,
			reason: 'stale',
		});
	});

	it('keeps tasks independent', () => {
		const state = emptyState();
		decide(state, task('a', 'SUCCEEDED'), all);
		expect(decide(state, task('b', 'IN_PROGRESS'), all)).toEqual({ accept: true });
	});

	it('rejects bodies without id or status', () => {
		expect(decide(emptyState(), { status: 'SUCCEEDED' }, all)).toEqual({
			accept: false,
			reason: 'invalid',
		});
	});

	it('filters by task type prefix and status, but still records the delivery', () => {
		const state = emptyState();
		const filters = {
			taskTypes: ['text-to-3d-preview', 'text-to-3d-refine'],
			statuses: ['SUCCEEDED'],
		};
		expect(decide(state, task('a', 'SUCCEEDED', 'image-to-3d'), filters)).toEqual({
			accept: false,
			reason: 'filtered',
		});
		expect(decide(state, task('b', 'IN_PROGRESS', 'text-to-3d-preview'), filters)).toEqual({
			accept: false,
			reason: 'filtered',
		});
		expect(decide(state, task('b', 'SUCCEEDED', 'text-to-3d-preview'), filters)).toEqual({
			accept: true,
		});
		// The filtered final for "a" still counts for stale detection.
		expect(decide(state, task('a', 'IN_PROGRESS', 'image-to-3d'), all)).toEqual({
			accept: false,
			reason: 'stale',
		});
	});

	it('stays bounded', () => {
		const state = emptyState();
		for (let i = 0; i < 1200; i++) decide(state, task(`t${i}`, 'SUCCEEDED'), all);
		expect(state.seen.length).toBeLessThanOrEqual(500);
		expect(Object.keys(state.final).length).toBeLessThanOrEqual(500);
	});
});

function webhookContext(opts: {
	secret: string;
	header?: string;
	body: IDataObject;
	params?: IDataObject;
	staticData?: IDataObject;
}) {
	const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
	const staticData = opts.staticData ?? {};
	const ctx = {
		getCredentials: async () => ({ apiKey: 'msy_x', webhookSecret: opts.secret }),
		getRequestObject: () => ({
			headers: opts.header === undefined ? {} : { 'x-meshy-api-webhook-secret-key': opts.header },
		}),
		getResponseObject: () => res,
		getBodyData: () => opts.body,
		getNodeParameter: (name: string, fallback: unknown) => opts.params?.[name] ?? fallback,
		getWorkflowStaticData: () => staticData,
		getNode: () => fakeNode,
	} as unknown as IWebhookFunctions;
	return { ctx, res, staticData };
}

describe('MeshyTrigger.webhook', () => {
	const node = new MeshyTrigger();
	const body = {
		id: 'task-1',
		type: 'rig',
		status: 'SUCCEEDED',
		progress: 100,
		created_at: 1747032400453,
		result: {},
	};

	it('rejects a wrong secret with 401 and does not start the workflow', async () => {
		const { ctx, res } = webhookContext({ secret: 'right', header: 'wrong', body });
		const out = await node.webhook.call(ctx);
		expect(res.status).toHaveBeenCalledWith(401);
		expect(out).toEqual({ noWebhookResponse: true });
	});

	it('rejects deliveries when no secret is configured', async () => {
		const { ctx, res } = webhookContext({ secret: '', header: 'anything', body });
		await node.webhook.call(ctx);
		expect(res.status).toHaveBeenCalledWith(401);
	});

	it('starts the workflow with a normalised task, then ignores the repeat', async () => {
		const staticData: IDataObject = {};
		const first = await node.webhook.call(
			webhookContext({ secret: 's', header: 's', body, staticData }).ctx,
		);
		const json = first.workflowData?.[0][0].json as IDataObject;
		expect(json).toMatchObject({ id: 'task-1', family: 'rigging', status: 'SUCCEEDED' });

		const again = await node.webhook.call(
			webhookContext({ secret: 's', header: 's', body, staticData }).ctx,
		);
		expect(again).toEqual({ webhookResponse: { received: true, ignored: 'duplicate' } });
	});

	it('ignores IN_PROGRESS by default status filter but answers below 400', async () => {
		const out = await node.webhook.call(
			webhookContext({
				secret: 's',
				header: 's',
				body: { ...body, status: 'IN_PROGRESS' },
				params: { statuses: ['SUCCEEDED', 'FAILED', 'CANCELED'] },
			}).ctx,
		);
		expect(out).toEqual({ webhookResponse: { received: true, ignored: 'filtered' } });
	});

	it('has a complete no-op webhook lifecycle', async () => {
		const hooks = node.webhookMethods.default;
		const ctx = {} as never;
		expect(await hooks.checkExists.call(ctx)).toBe(false);
		expect(await hooks.create.call(ctx)).toBe(true);
		expect(await hooks.delete.call(ctx)).toBe(true);
	});
});
