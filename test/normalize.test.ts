import type { IDataObject } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';
import { FAMILIES } from '../nodes/Meshy/families';
import { normalizeTask, toIso } from '../nodes/Meshy/normalize';
import { loadFixture, FIXTURE_NAMES } from './fixtures';

describe('normalizeTask with recorded fixtures', () => {
	for (const family of FAMILIES) {
		const name = FIXTURE_NAMES[family.value];
		it(`${family.value}: get fixture normalises with the full output shape`, () => {
			const raw = loadFixture(name, 'get');
			const task = normalizeTask(raw, family.value, family.output);
			expect(task.id).toBe(raw.id);
			expect(task.family).toBe(family.value);
			expect(task.status).toBe('SUCCEEDED');
			expect(task.raw).toBe(raw);
			expect(task.created_at).toMatch(/^\d{4}-\d\d-\d\dT/);
			for (const key of [
				'progress',
				'name',
				'model_urls',
				'thumbnail_url',
				'texture_urls',
				'error',
				'finished_at',
			]) {
				expect(task).toHaveProperty(key);
			}
			if (family.output === 'image') expect(task.image_urls?.length).toBeGreaterThan(0);
			if (
				['model', 'rig', 'animation'].includes(family.output) &&
				family.value !== 'printAnalyze'
			) {
				// Every model family's example has at least one downloadable model URL.
				expect(Object.keys(task.model_urls).length).toBeGreaterThan(0);
			}
		});

		it(`${family.value}: create fixture has a task id in result`, () => {
			const created = loadFixture(name, 'create');
			expect(typeof created.result).toBe('string');
		});
	}

	it('maps rigging result files into model_urls', () => {
		const task = normalizeTask(loadFixture('rigging', 'get'), 'rigging', 'rig');
		expect(Object.keys(task.model_urls).sort()).toEqual(['fbx', 'glb']);
		expect(task.model_urls.fbx).toContain('Character_output.fbx');
	});

	it('maps animation result files into model_urls', () => {
		const task = normalizeTask(loadFixture('animations', 'get'), 'animation', 'animation');
		expect(task.model_urls.fbx).toContain('.fbx');
		expect(task.model_urls.glb).toContain('.glb');
	});
});

describe('normalizeTask edge cases', () => {
	it('handles a pending task with no outputs yet', () => {
		const raw: IDataObject = {
			id: 'x',
			status: 'PENDING',
			progress: 0,
			created_at: 1700000000000,
			finished_at: 0,
		};
		const task = normalizeTask(raw, 'imageTo3d', 'model');
		expect(task.model_urls).toEqual({});
		expect(task.finished_at).toBeNull();
		expect(task.error).toBeNull();
		expect(task.thumbnail_url).toBeNull();
	});

	it('keeps only formats that are present and non-empty', () => {
		const raw: IDataObject = {
			id: 'x',
			status: 'SUCCEEDED',
			model_urls: { glb: 'https://assets.meshy.ai/a.glb', fbx: '' },
		};
		expect(normalizeTask(raw, 'remesh', 'model').model_urls).toEqual({
			glb: 'https://assets.meshy.ai/a.glb',
		});
	});

	it('surfaces task_error message and code', () => {
		const raw: IDataObject = {
			id: 'x',
			status: 'FAILED',
			task_error: { message: 'Bad image', code: 'invalid' },
		};
		expect(normalizeTask(raw, 'imageTo3d', 'model').error).toEqual({
			message: 'Bad image',
			code: 'invalid',
		});
	});

	it('treats an empty task_error message as no error', () => {
		const raw: IDataObject = { id: 'x', status: 'SUCCEEDED', task_error: { message: '' } };
		expect(normalizeTask(raw, 'imageTo3d', 'model').error).toBeNull();
	});

	it('converts epoch ms to ISO and 0 to null', () => {
		expect(toIso(1692771650657)).toBe('2023-08-23T06:20:50.657Z');
		expect(toIso(0)).toBeNull();
		expect(toIso(undefined)).toBeNull();
	});
});
