import type { IDataObject } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';
import { buildCreateBody, splitList, toDataUri, type ParamReader } from '../nodes/Meshy/body';
import { FAMILIES } from '../nodes/Meshy/families';
import { createFields } from '../nodes/Meshy/generated/fields';

function reader(params: IDataObject, binaries: Record<string, string> = {}): ParamReader {
	return {
		get: (name) => (name in params ? params[name] : null),
		binaryToDataUri: vi.fn(async (prop: string) => {
			if (!(prop in binaries)) throw new Error(`no binary ${prop}`);
			return binaries[prop];
		}),
	};
}

/** Parameters as n8n would hand them over with every top-level field left at its default. */
function defaults(family: string): IDataObject {
	const out: IDataObject = {};
	for (const prop of createFields[family]) {
		if (prop.name !== 'additionalFields') out[prop.name] = prop.default as IDataObject[string];
	}
	return out;
}

describe('buildCreateBody', () => {
	it('image to 3D from a URL', async () => {
		const body = await buildCreateBody(
			'imageTo3d',
			reader({
				...defaults('imageTo3d'),
				inputType: 'url',
				sourceUrl: ' https://example.com/a.png ',
			}),
		);
		expect(body.image_url).toBe('https://example.com/a.png');
		expect(body.ai_model).toBe('latest');
		expect(body).not.toHaveProperty('input_task_id');
	});

	it('image to 3D from a binary property becomes a data URI', async () => {
		const body = await buildCreateBody(
			'imageTo3d',
			reader(
				{ inputType: 'binary', binaryPropertyName: 'photo' },
				{ photo: 'data:image/png;base64,AAAA' },
			),
		);
		expect(body.image_url).toBe('data:image/png;base64,AAAA');
	});

	it('image to 3D from a previous task', async () => {
		const body = await buildCreateBody(
			'imageTo3d',
			reader({ inputType: 'taskId', inputTaskId: 'abc' }),
		);
		expect(body).toEqual({ input_task_id: 'abc' });
	});

	it('multi-image rejects more than 4 images', async () => {
		await expect(
			buildCreateBody('multiImageTo3d', reader({ inputType: 'urls', sourceUrls: 'a,b,c,d,e' })),
		).rejects.toThrow(/at most 4/);
	});

	it('multi-image reads several binary properties', async () => {
		const body = await buildCreateBody(
			'multiImageTo3d',
			reader(
				{ inputType: 'binaries', binaryPropertyNames: 'front, back' },
				{ front: 'data:a', back: 'data:b' },
			),
		);
		expect(body.image_urls).toEqual(['data:a', 'data:b']);
	});

	it('sends a custom ai_model when Custom is picked', async () => {
		const body = await buildCreateBody(
			'imageTo3d',
			reader({
				inputType: 'taskId',
				inputTaskId: 'x',
				aiModel: '__custom',
				customAiModel: 'meshy-9',
			}),
		);
		expect(body.ai_model).toBe('meshy-9');
	});

	it('maps Additional Fields, lists and nested objects to API names', async () => {
		const body = await buildCreateBody(
			'imageTo3d',
			reader({
				inputType: 'taskId',
				inputTaskId: 'x',
				additionalFields: {
					targetPolycount: 5000,
					targetFormats: ['glb', 'fbx'],
					shouldTexture: false,
					experimental: { turbo: true },
					texturePrompt: '',
				},
			}),
		);
		expect(body).toMatchObject({
			target_polycount: 5000,
			target_formats: ['glb', 'fbx'],
			should_texture: false,
			experimental: { turbo: true },
		});
		expect(body).not.toHaveProperty('texture_prompt');
	});

	it('text to 3D preview sends mode and prompt, refine sends the preview id', async () => {
		const preview = await buildCreateBody(
			'textTo3d',
			reader({ mode: 'preview', prompt: 'a red chair', aiModel: 'latest' }),
		);
		expect(preview).toMatchObject({ mode: 'preview', prompt: 'a red chair' });
		const refine = await buildCreateBody(
			'textTo3d',
			reader({ mode: 'refine', previewTaskId: 'p1' }),
		);
		expect(refine).toEqual({ mode: 'refine', preview_task_id: 'p1' });
	});

	it('animation uses action_id unless action_ids or a motion task is given', async () => {
		const single = await buildCreateBody('animation', reader({ rigTaskId: 'r', actionId: 92 }));
		expect(single).toEqual({ rig_task_id: 'r', action_id: 92 });
		const many = await buildCreateBody(
			'animation',
			reader({ rigTaskId: 'r', actionId: 0, additionalFields: { actionIds: '1, 2, 3' } }),
		);
		expect(many).toEqual({ rig_task_id: 'r', action_ids: [1, 2, 3] });
	});

	it('rejects non-numeric action ids', async () => {
		await expect(
			buildCreateBody(
				'animation',
				reader({ rigTaskId: 'r', additionalFields: { actionIds: '1, two' } }),
			),
		).rejects.toThrow(/whole numbers/);
	});

	it('requires an input value', async () => {
		await expect(
			buildCreateBody('remesh', reader({ inputType: 'taskId', inputTaskId: ' ' })),
		).rejects.toThrow(/ID of the input task/);
	});

	// Every family should produce a body from its defaults plus a minimal input.
	for (const family of FAMILIES) {
		it(`${family.value}: builds a body from default parameters`, async () => {
			const params: IDataObject = {
				...defaults(family.value),
				inputTaskId: 'task-1',
				sourceUrl: 'https://x.test/a',
				sourceUrls: 'https://x.test/a',
			};
			if (family.source)
				params.inputType = family.source.modes.includes('taskId') ? 'taskId' : 'url';
			const body = await buildCreateBody(family.value, reader(params));
			expect(Object.keys(body).length).toBeGreaterThan(0);
			for (const key of Object.keys(body)) expect(key).toMatch(/^[a-z0-9_]+$/);
		});
	}
});

describe('helpers', () => {
	it('splitList handles commas, new lines and blanks', () => {
		expect(splitList('a, b\nc,,')).toEqual(['a', 'b', 'c']);
		expect(splitList(undefined)).toEqual([]);
	});

	it('toDataUri builds a base64 data URI', () => {
		expect(toDataUri(Buffer.from('hi').toString('base64'), 'image/png')).toBe(
			'data:image/png;base64,aGk=',
		);
		expect(toDataUri('AA==', '')).toBe('data:application/octet-stream;base64,AA==');
	});
});
