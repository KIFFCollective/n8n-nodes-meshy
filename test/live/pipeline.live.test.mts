// Opt-in live test of the full M1 + M2 pipeline. Spends real credits (about 21).
// Run: MESHY_LIVE=1 npx vitest run test/live
// Task ids are saved in test/live/.state.json so a rerun resumes instead of paying again.
import type { IDataObject, INodeExecutionData } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';
import { LIVE, runNode, saveState, spend, state } from './harness.mts';

const MIN = 60_000;

/** Creates a task once (remembering its id), then waits for it with the real Wait operation. */
async function createAndWait(key: string, cost: number, resource: string, params: IDataObject, input?: INodeExecutionData[]) {
	if (!state[key]) {
		spend(cost, key);
		const [created] = await runNode({ resource, operation: 'create', ...params }, input);
		expect(created.json.status).toBe('PENDING');
		state[key] = created.json.id;
		saveState();
		console.log(`${key}: created ${created.json.id}`);
	}
	const [done] = await runNode({ resource, operation: 'wait', taskId: state[key], timeoutMinutes: 25 });
	console.log(`${key}: ${done.json.status}, formats: ${Object.keys(done.json.model_urls as object).join(',')}`);
	return done;
}

describe.skipIf(!LIVE)('live pipeline', () => {
	it('free calls: balance, library, list', async () => {
		const [balance] = await runNode({ resource: 'account', operation: 'getBalance' });
		expect(typeof balance.json.balance).toBe('number');
		console.log(`balance before: ${balance.json.balance}`);

		const library = await runNode({ resource: 'animation', operation: 'getLibrary', libraryFilters: { search: 'walk' } });
		const biped = library.find((item) => item.json.rig_type === 'biped');
		expect(biped).toBeDefined();
		state.actionId = biped!.json.action_id;
		saveState();

		const list = await runNode({ resource: 'imageTo3d', operation: 'getAll', returnAll: false, limit: 3 });
		expect(Array.isArray(list)).toBe(true);
	});

	it('text to image, then download the image as binary', { timeout: 20 * MIN }, async () => {
		const done = await createAndWait('textToImage', 3, 'textToImage', {
			aiModel: 'nano-banana',
			prompt:
				'Full body cartoon robot character standing in a T-pose, arms straight out, front view, plain white background, no shadows',
		});
		expect(done.json.image_urls).toHaveLength(1);
		const [file] = await runNode(
			{ resource: 'textToImage', operation: 'download', downloadSource: 'item', format: 'image', binaryPropertyOutput: 'image' },
			[done],
		);
		expect(file.binary?.image.mimeType).toMatch(/^image\//);
		state.imageItem = { json: {}, binary: { photo: file.binary!.image } } as unknown as IDataObject;
		saveState();
	});

	it('image to 3D from binary data (base64 data URI), then download GLB', { timeout: 30 * MIN }, async () => {
		const input = [state.imageItem as unknown as INodeExecutionData];
		const done = await createAndWait(
			'imageTo3d',
			5,
			'imageTo3d',
			{ inputType: 'binary', binaryPropertyName: 'photo', aiModel: 'meshy-6-lite', additionalFields: { shouldTexture: false } },
			input,
		);
		const [file] = await runNode({
			resource: 'imageTo3d',
			operation: 'download',
			downloadSource: 'taskId',
			taskId: state.imageTo3d,
			format: 'glb',
			binaryPropertyOutput: 'data',
		});
		const bytes = Buffer.from(file.binary!.data.data, 'base64');
		expect(bytes.subarray(0, 4).toString()).toBe('glTF');
		expect(file.binary!.data.fileName).toMatch(/\.glb$/);
	});

	it('remesh, rig and animate by chaining task ids, then download FBX', { timeout: 60 * MIN }, async () => {
		await createAndWait('remesh', 5, 'remesh', {
			inputType: 'taskId',
			inputTaskId: state.imageTo3d,
			additionalFields: { targetPolycount: 20000, targetFormats: ['glb'] },
		});
		await createAndWait('rigging', 5, 'rigging', { inputType: 'taskId', inputTaskId: state.remesh });
		const anim = await createAndWait('animation', 3, 'animation', {
			rigTaskId: state.rigging,
			actionId: state.actionId,
		});
		expect(anim.json.model_urls).toHaveProperty('fbx');
		const [file] = await runNode(
			{ resource: 'animation', operation: 'download', downloadSource: 'item', format: 'fbx', binaryPropertyOutput: 'data' },
			[anim],
		);
		expect(Number(file.binary!.data.fileSize)).toBeGreaterThan(1000);
		console.log(`credits spent this run (estimated): ${state.spent}`);
	});
});
