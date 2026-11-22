import { describe, expect, it } from 'vitest';
import { assertSafeUrl, fileNameFor, mimeFor, pickUrl } from '../nodes/Meshy/download';
import { normalizeTask } from '../nodes/Meshy/normalize';
import { loadFixture } from './fixtures';

const imageTask = normalizeTask(loadFixture('image-to-3d', 'get'), 'imageTo3d', 'model');

describe('pickUrl', () => {
	it('returns the URL for a produced format', () => {
		expect(pickUrl(imageTask, 'glb')).toContain('model.glb');
		expect(pickUrl(imageTask, 'pre_remeshed_glb')).toContain('pre_remeshed_model.glb');
		expect(pickUrl(imageTask, 'thumbnail')).toContain('preview.png');
	});

	it('explains a missing format and lists what exists', () => {
		expect(() => pickUrl(imageTask, '3mf')).toThrow(/no "3mf" output.*Available formats: glb, fbx/);
	});

	it('picks image outputs by index', () => {
		const t2i = normalizeTask(loadFixture('text-to-image', 'get'), 'textToImage', 'image');
		expect(pickUrl(t2i, 'image', 0)).toContain('image.png');
		expect(() => pickUrl(t2i, 'image', 5)).toThrow(/no "image" output/);
	});

	it('reads the relief depth map from the raw task', () => {
		const relief = normalizeTask(loadFixture('relief', 'get'), 'relief', 'model');
		expect(pickUrl(relief, 'depth_map')).toMatch(/^https:/);
	});
});

describe('assertSafeUrl', () => {
	it('accepts https meshy.ai hosts', () => {
		expect(assertSafeUrl('https://assets.meshy.ai/a.glb', false).hostname).toBe('assets.meshy.ai');
	});

	it('rejects plain http', () => {
		expect(() => assertSafeUrl('http://assets.meshy.ai/a.glb', true)).toThrow(/https/);
	});

	it('rejects other hosts unless allowed', () => {
		expect(() => assertSafeUrl('https://evil.example/a.glb', false)).toThrow(/Refusing/);
		expect(() => assertSafeUrl('https://meshy.ai.evil.example/a.glb', false)).toThrow(/Refusing/);
		expect(assertSafeUrl('https://evil.example/a.glb', true).hostname).toBe('evil.example');
	});

	it('rejects junk', () => {
		expect(() => assertSafeUrl('not a url', true)).toThrow(/valid URL/);
	});
});

describe('file names and mime types', () => {
	it('names the file from the task name, falling back to the id', () => {
		const url = new URL('https://assets.meshy.ai/x/model.glb');
		expect(fileNameFor({ id: 'abc', name: 'My Robot!' }, 'glb', url)).toBe('My_Robot_.glb');
		expect(fileNameFor({ id: 'abc', name: null }, 'glb', url)).toBe('abc.glb');
		expect(fileNameFor({ id: 'abc' }, 'pre_remeshed_glb', url)).toBe('abc_pre_remeshed.glb');
		expect(
			fileNameFor(
				{ id: 'abc' },
				'thumbnail',
				new URL('https://assets.meshy.ai/x/preview.png?Expires=1'),
			),
		).toBe('abc_thumbnail.png');
	});

	it('prefers known 3D mime types over octet-stream', () => {
		expect(mimeFor('a.glb', 'application/octet-stream')).toBe('model/gltf-binary');
		expect(mimeFor('a.fbx', 'application/octet-stream')).toBe('application/octet-stream');
		expect(mimeFor('a.png', 'image/png; charset=binary')).toBe('image/png');
	});
});
