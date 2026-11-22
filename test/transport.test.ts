import { NodeApiError, type IExecuteFunctions } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';
import { describeError, meshyRequest, retryAfterSeconds } from '../nodes/Meshy/transport';
import { fakeContext } from './helpers';

const call = (ctx: unknown, ...args: Parameters<typeof meshyRequest>) =>
	meshyRequest.call(ctx as IExecuteFunctions, ...args);

describe('meshyRequest', () => {
	it('returns the body and headers on success', async () => {
		const { ctx, httpRequestWithAuthentication } = fakeContext([
			{ statusCode: 200, body: { balance: 5 }, headers: { 'retry-after': '3' } },
		]);
		const res = await call(ctx, 'GET', '/v1/balance');
		expect(res.body).toEqual({ balance: 5 });
		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'meshyApi',
			expect.objectContaining({ url: 'https://api.meshy.ai/openapi/v1/balance', method: 'GET' }),
		);
	});

	it('retries a read after 429, waiting Retry-After seconds', async () => {
		const sleepFn = vi.fn(async () => {});
		const { ctx, httpRequestWithAuthentication } = fakeContext([
			{ statusCode: 429, body: { message: 'Rate limit exceeded' }, headers: { 'retry-after': '2' } },
			{ statusCode: 200, body: { ok: true } },
		]);
		const res = await call(ctx, 'GET', '/v1/image-to-3d/abc', { sleepFn });
		expect(res.body).toEqual({ ok: true });
		expect(sleepFn).toHaveBeenCalledWith(2000);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
	});

	it('gives up on reads after 3 retries', async () => {
		const sleepFn = vi.fn(async () => {});
		const limited = { statusCode: 429, body: { message: 'Rate limit exceeded' }, headers: { 'retry-after': '1' } };
		const { ctx, httpRequestWithAuthentication } = fakeContext([limited, limited, limited, limited]);
		await expect(call(ctx, 'GET', '/v1/remesh', { sleepFn })).rejects.toThrow(/rate limit/i);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(4);
	});

	it('never retries a create call on 429', async () => {
		const sleepFn = vi.fn(async () => {});
		const { ctx, httpRequestWithAuthentication } = fakeContext([
			{ statusCode: 429, body: { message: 'Rate limit exceeded' }, headers: { 'retry-after': '1' } },
		]);
		await expect(call(ctx, 'POST', '/v1/image-to-3d', { isCreate: true, sleepFn })).rejects.toThrow(
			/not retried/,
		);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		expect(sleepFn).not.toHaveBeenCalled();
	});

	it('never retries a create call on 5xx and tells the user to check recent tasks', async () => {
		const { ctx, httpRequestWithAuthentication } = fakeContext([{ statusCode: 503, body: { message: 'busy' } }]);
		await expect(call(ctx, 'POST', '/v1/rigging', { isCreate: true })).rejects.toThrow(/Get Many/);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
	});

	it('does not retry the concurrency 429, which has no Retry-After', async () => {
		const { ctx, httpRequestWithAuthentication } = fakeContext([
			{ statusCode: 429, body: { message: 'NoMorePendingTasks: limit reached' } },
		]);
		await expect(call(ctx, 'GET', '/v1/remesh')).rejects.toThrow(/Too many Meshy tasks/);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
	});

	it('throws NodeApiError with the Meshy message and code', async () => {
		const { ctx } = fakeContext([{ statusCode: 400, body: { message: 'Invalid image', code: 'bad_input' } }]);
		const error = await call(ctx, 'POST', '/v1/image-to-3d', { isCreate: true }).catch((e) => e);
		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.message).toBe('Meshy rejected the request parameters.');
		expect(error.description).toBe('Meshy says: Invalid image (code: bad_input)');
		expect(error.httpCode).toBe('400');
	});
});

describe('describeError', () => {
	it.each([
		[401, '', /API key/],
		[402, '', /credits/],
		[400, 'Insufficient credits', /credits/],
		[409, '', /PENDING/],
		[404, '', /could not find/],
	])('maps %i to a plain message', (status, msg, expected) => {
		expect(describeError(status, msg, false)).toMatch(expected);
	});
});

describe('retryAfterSeconds', () => {
	it('reads the header in either case and ignores junk', () => {
		expect(retryAfterSeconds({ 'retry-after': '7' })).toBe(7);
		expect(retryAfterSeconds({ 'Retry-After': '1' })).toBe(1);
		expect(retryAfterSeconds({ 'retry-after': 'soon' })).toBeUndefined();
		expect(retryAfterSeconds({})).toBeUndefined();
	});
});
