import type { INode } from 'n8n-workflow';
import { vi } from 'vitest';

export const fakeNode: INode = {
	id: 'test-node',
	name: 'Meshy',
	type: 'n8n-nodes-meshy.meshy',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

export interface FakeResponse {
	statusCode: number;
	body?: unknown;
	headers?: Record<string, string>;
}

/** A minimal stand-in for n8n's execute context, enough for transport calls. */
export function fakeContext(responses: FakeResponse[]) {
	const queue = [...responses];
	const httpRequestWithAuthentication = vi.fn(async () => {
		const next = queue.shift();
		if (!next) throw new Error('No more fake responses queued');
		return { statusCode: next.statusCode, body: next.body ?? {}, headers: next.headers ?? {} };
	});
	return {
		ctx: { helpers: { httpRequestWithAuthentication }, getNode: () => fakeNode },
		httpRequestWithAuthentication,
	};
}
