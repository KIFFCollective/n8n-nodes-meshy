// Opt-in live smoke test of the print family. About 50 credits.
// Reuses tasks from the pipeline and families live tests.
// Run: MESHY_LIVE=1 npx vitest run test/live/print.live.test.mts
import { describe, expect, it } from 'vitest';
import { createAndWait, LIVE, runNode, state } from './harness.mts';

const MIN = 60_000;
const IMAGE = 'https://cdn.meshy.ai/webapp-assets/doc/image-to-3d-p0-1.webp';

describe.skipIf(!LIVE)('live print family smoke test', () => {
	it('repair for printing, then download', { timeout: 20 * MIN }, async () => {
		const done = await createAndWait('printRepair', 10, 'printRepair', {
			inputType: 'taskId',
			inputTaskId: state.imageTo3d,
			additionalFields: { printerType: 'fdm', intendedPrintHeightMm: 80 },
		});
		const formats = Object.keys(done.json.model_urls as object);
		expect(formats.length).toBeGreaterThan(0);
		const [file] = await runNode(
			{
				resource: 'printRepair',
				operation: 'download',
				downloadSource: 'item',
				format: formats[0],
				binaryPropertyOutput: 'data',
			},
			[done],
		);
		expect(Number(file.binary!.data.fileSize)).toBeGreaterThan(1000);
	});

	it('multi-color 3MF from a textured model', { timeout: 20 * MIN }, async () => {
		const done = await createAndWait('printMultiColor', 10, 'printMultiColor', {
			inputType: 'taskId',
			inputTaskId: state.retexture,
			additionalFields: { maxColors: 4 },
		});
		expect(done.json.model_urls).toHaveProperty('3mf');
	});

	it('auto split a Meshy 6 model into parts', { timeout: 20 * MIN }, async () => {
		const done = await createAndWait('printSplit', 10, 'printSplit', {
			inputTaskId: state.textTo3dPreview,
			additionalFields: { targetFormats: ['glb'] },
		});
		expect(done.json.model_urls).toHaveProperty('glb');
		console.log('part_count:', (done.json.raw as { part_count?: number }).part_count);
	});

	it('relief from a photo, with depth map download', { timeout: 20 * MIN }, async () => {
		const done = await createAndWait('relief', 20, 'relief', {
			inputType: 'url',
			sourceUrl: IMAGE,
			additionalFields: { targetFormats: ['glb'], meshResolution: 512 },
		});
		expect(done.json.model_urls).toHaveProperty('glb');
		const [depth] = await runNode(
			{
				resource: 'relief',
				operation: 'download',
				downloadSource: 'item',
				format: 'depth_map',
				binaryPropertyOutput: 'data',
			},
			[done],
		);
		expect(depth.binary!.data.mimeType).toMatch(/^image\//);
	});
});
