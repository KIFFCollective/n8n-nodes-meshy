// Opt-in live test of Create with Stop After (0.2.0). Spends real credits (about 16).
// Run: MESHY_LIVE=1 npx vitest run test/live/stop-after.live.test.mts
// Each finished step is saved in test/live/.state.json and skipped on a rerun.
import { describe, expect, it } from 'vitest';
import { LIVE, runNode, saveState, spend, state } from './harness.mts';

const MIN = 60_000;

describe.skipIf(!LIVE)('live Create with Stop After', () => {
	it('text to 3D preview, Task Finished', { timeout: 30 * MIN }, async () => {
		if (state.stopAfterPreview) return;
		spend(5, 'stopAfterPreview');
		const out = await runNode({
			resource: 'textTo3d',
			operation: 'create',
			mode: 'preview',
			prompt: 'a small ceramic teapot',
			aiModel: 'meshy-6-lite',
			stopAfter: 'finished',
			timeoutMinutes: 25,
		});
		expect(out).toHaveLength(1);
		expect(out[0].json).toMatchObject({ family: 'textTo3d', status: 'SUCCEEDED' });
		expect(out[0].json.model_urls).toHaveProperty('glb');
		expect(out[0].binary).toBeUndefined();
		state.stopAfterPreview = out[0].json.id;
		saveState();
		console.log(`stopAfterPreview: ${out[0].json.id}`);
	});

	it('image to 3D from a URL, File Downloaded (GLB)', { timeout: 30 * MIN }, async () => {
		if (state.stopAfterImageTo3d) return;
		spend(5, 'stopAfterImageTo3d');
		const [item] = await runNode({
			resource: 'imageTo3d',
			operation: 'create',
			inputType: 'url',
			sourceUrl: 'https://cdn.meshy.ai/webapp-assets/doc/image-to-3d-p0-1.webp',
			aiModel: 'meshy-6-lite',
			additionalFields: { shouldTexture: false },
			stopAfter: 'downloaded',
			timeoutMinutes: 25,
			format: 'glb',
			binaryPropertyOutput: 'data',
		});
		expect(item.json.status).toBe('SUCCEEDED');
		const bytes = Buffer.from(item.binary!.data.data, 'base64');
		expect(bytes.subarray(0, 4).toString()).toBe('glTF');
		expect(item.binary!.data.fileName).toMatch(/\.glb$/);
		state.stopAfterImageTo3d = item.json.id;
		saveState();
		console.log(`stopAfterImageTo3d: ${item.json.id}, ${bytes.length} bytes`);
	});

	it('text to image, two items in one run, File Downloaded', { timeout: 20 * MIN }, async () => {
		if (state.stopAfterTextToImage) return;
		spend(6, 'stopAfterTextToImage');
		const started = Date.now();
		const out = await runNode(
			{
				resource: 'textToImage',
				operation: 'create',
				aiModel: 'nano-banana',
				prompt: 'A single red apple on a plain white background',
				stopAfter: 'downloaded',
				timeoutMinutes: 15,
				format: 'image',
				binaryPropertyOutput: 'image',
			},
			[{ json: { n: 0 } }, { json: { n: 1 } }],
		);
		expect(out).toHaveLength(2);
		for (const [n, item] of out.entries()) {
			expect(item.pairedItem).toEqual({ item: n });
			expect(item.json.status).toBe('SUCCEEDED');
			expect(item.binary?.image.mimeType).toMatch(/^image\//);
		}
		expect(out[0].json.id).not.toBe(out[1].json.id);
		state.stopAfterTextToImage = out.map((o) => o.json.id);
		saveState();
		console.log(
			`stopAfterTextToImage: ${out.map((o) => o.json.id).join(', ')} in ${Math.round((Date.now() - started) / 1000)} s`,
		);
	});
});
