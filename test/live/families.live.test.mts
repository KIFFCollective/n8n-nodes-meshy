// Opt-in live smoke test of the families the pipeline test does not cover. About 40 credits.
// Needs the pipeline test to have run first (it reuses its image to 3D and remesh tasks).
// Run: MESHY_LIVE=1 npx vitest run test/live/families.live.test.mts
import { describe, expect, it } from 'vitest';
import { createAndWait, LIVE, runNode, state } from './harness.mts';

const MIN = 60_000;
const IMAGE = 'https://cdn.meshy.ai/webapp-assets/doc/image-to-3d-p0-1.webp';

function needs(...keys: string[]) {
	for (const k of keys)
		if (!state[k]) throw new Error(`Run the pipeline live test first: missing ${k}`);
}

describe.skipIf(!LIVE)('live families smoke test', () => {
	it('text to 3D: preview then refine, download GLB', { timeout: 30 * MIN }, async () => {
		const preview = await createAndWait('textTo3dPreview', 5, 'textTo3d', {
			mode: 'preview',
			prompt: 'a small wooden treasure chest',
			aiModel: 'meshy-6-lite',
		});
		expect(preview.json.status).toBe('SUCCEEDED');
		const refine = await createAndWait('textTo3dRefine', 10, 'textTo3d', {
			mode: 'refine',
			previewTaskId: state.textTo3dPreview,
			aiModel: 'latest',
		});
		expect(refine.json.texture_urls).not.toHaveLength(0);
		const [file] = await runNode(
			{
				resource: 'textTo3d',
				operation: 'download',
				downloadSource: 'item',
				format: 'glb',
				binaryPropertyOutput: 'data',
			},
			[refine],
		);
		expect(Buffer.from(file.binary!.data.data, 'base64').subarray(0, 4).toString()).toBe('glTF');
	});

	it('multi-image to 3D from URLs', { timeout: 30 * MIN }, async () => {
		const done = await createAndWait('multiImageTo3d', 5, 'multiImageTo3d', {
			inputType: 'urls',
			sourceUrls: `${IMAGE}, ${IMAGE}`,
			aiModel: 'meshy-6-lite',
			additionalFields: { shouldTexture: false },
		});
		expect(done.json.model_urls).toHaveProperty('glb');
	});

	it('retexture a previous task with a text style', { timeout: 30 * MIN }, async () => {
		needs('imageTo3d');
		const done = await createAndWait('retexture', 10, 'retexture', {
			inputType: 'taskId',
			inputTaskId: state.imageTo3d,
			textStylePrompt: 'shiny red and gold metal',
			aiModel: 'meshy-6-lite',
		});
		expect(done.json.model_urls).toHaveProperty('glb');
	});

	it('convert, resize and UV unwrap the remeshed model', { timeout: 30 * MIN }, async () => {
		needs('remesh');
		const converted = await createAndWait('convert', 1, 'convert', {
			inputType: 'taskId',
			inputTaskId: state.remesh,
			targetFormats: ['fbx', 'stl'],
		});
		expect(Object.keys(converted.json.model_urls as object)).toEqual(
			expect.arrayContaining(['fbx', 'stl']),
		);

		const resized = await createAndWait('resize', 1, 'resize', {
			inputType: 'taskId',
			inputTaskId: state.remesh,
			additionalFields: { resizeHeight: 1.5 },
		});
		expect(Object.keys(resized.json.model_urls as object).length).toBeGreaterThan(0);

		const unwrapped = await createAndWait('uvUnwrap', 5, 'uvUnwrap', {
			inputType: 'taskId',
			inputTaskId: state.remesh,
		});
		expect(Object.keys(unwrapped.json.model_urls as object).length).toBeGreaterThan(0);
	});

	it('image to image from a reference URL, download the image', { timeout: 20 * MIN }, async () => {
		const done = await createAndWait('imageToImage', 3, 'imageToImage', {
			inputType: 'urls',
			sourceUrls: IMAGE,
			aiModel: 'nano-banana',
			prompt: 'the same object, painted bright red',
		});
		expect(done.json.image_urls).not.toHaveLength(0);
		const [file] = await runNode(
			{
				resource: 'imageToImage',
				operation: 'download',
				downloadSource: 'item',
				format: 'image',
				binaryPropertyOutput: 'data',
			},
			[done],
		);
		expect(file.binary!.data.mimeType).toMatch(/^image\//);
	});

	it('printability analysis (free)', { timeout: 20 * MIN }, async () => {
		needs('imageTo3d');
		const done = await createAndWait('printAnalyze', 0, 'printAnalyze', {
			inputType: 'taskId',
			inputTaskId: state.imageTo3d,
		});
		expect(done.json.raw).toHaveProperty('printability');
		console.log(
			'printability:',
			JSON.stringify((done.json.raw as { printability: unknown }).printability).slice(0, 200),
		);
	});
});
