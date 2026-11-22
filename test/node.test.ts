import type { INodeProperties } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';
import { MeshyApi } from '../credentials/MeshyApi.credentials';
import { FAMILIES } from '../nodes/Meshy/families';
import { Meshy } from '../nodes/Meshy/Meshy.node';

const { description } = new Meshy();
const props = description.properties;

function visibleFor(resource: string, operation: string): INodeProperties[] {
	return props.filter((p) => {
		const show = p.displayOptions?.show ?? {};
		const res = show.resource as string[] | undefined;
		const op = show.operation as string[] | undefined;
		return (
			(!res || res.includes(resource)) && (!op || op.includes(operation)) && p.name !== 'resource'
		);
	});
}

describe('Meshy node description', () => {
	it('lists every family plus Account and Any Task Type as resources', () => {
		const resource = props.find((p) => p.name === 'resource');
		const values = (resource?.options as Array<{ value: string }>).map((o) => o.value);
		expect(values.sort()).toEqual(['account', 'task', ...FAMILIES.map((f) => f.value)].sort());
	});

	for (const family of FAMILIES) {
		it(`${family.value}: has the shared task operations`, () => {
			const op = props.find(
				(p) =>
					p.name === 'operation' &&
					(p.displayOptions?.show?.resource as string[]).includes(family.value),
			);
			const values = (op?.options as Array<{ value: string }>).map((o) => o.value);
			expect(values).toEqual(
				expect.arrayContaining(['create', 'get', 'getAll', 'cancel', 'download', 'wait']),
			);
		});

		it(`${family.value}: create form has no duplicate parameter names in the same condition`, () => {
			const create = visibleFor(family.value, 'create').filter((p) => p.name !== 'operation');
			const keys = create.map((p) => `${p.name}|${JSON.stringify(p.displayOptions?.show ?? {})}`);
			expect(new Set(keys).size).toBe(keys.length);
		});
	}

	it('every parameter has a default', () => {
		for (const p of props) expect(p, p.name).toHaveProperty('default');
	});

	it('marks Create as non-retrying in its description', () => {
		const op = props.find(
			(p) => p.name === 'operation' && p.displayOptions?.show?.resource?.includes('imageTo3d'),
		);
		const create = (op?.options as Array<{ value: string; description: string }>).find(
			(o) => o.value === 'create',
		);
		expect(create?.description).toMatch(/Do not turn on Retry On Fail/);
	});

	it('contains no em dashes in user-facing text', () => {
		expect(JSON.stringify(description)).not.toMatch(/—/);
	});
});

describe('Meshy credential', () => {
	it('tests against GET /v1/balance with a bearer token', () => {
		const cred = new MeshyApi();
		expect(cred.test.request.url).toBe('/v1/balance');
		expect(cred.authenticate.properties.headers?.Authorization).toBe(
			'=Bearer {{$credentials.apiKey}}',
		);
		expect(cred.properties.find((p) => p.name === 'apiKey')?.typeOptions?.password).toBe(true);
	});
});
