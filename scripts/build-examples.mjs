// Writes the importable example workflows in examples/. Run: node scripts/build-examples.mjs
// Generated so node ids, positions and connections stay consistent as the node changes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = join(import.meta.dirname, '../examples');
mkdirSync(outDir, { recursive: true });

const MESHY = 'n8n-nodes-meshy.meshy';
const CREDS = { meshyApi: { id: 'REPLACE_ME', name: 'Meshy account' } };

function workflow(name, steps, extraConnections = {}) {
	const nodes = steps.map((s, i) => ({
		id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${i}`,
		name: s.name,
		type: s.type ?? MESHY,
		typeVersion: s.typeVersion ?? 1,
		position: s.position ?? [i * 240, 0],
		parameters: s.parameters,
		...(s.webhookId ? { webhookId: s.webhookId } : {}),
		...(s.type && !s.credentials ? {} : { credentials: CREDS }),
	}));
	const connections = {};
	for (let i = 0; i < steps.length - 1; i++) {
		if (steps[i].noAutoConnect) continue;
		connections[steps[i].name] = { main: [[{ node: steps[i + 1].name, type: 'main', index: 0 }]] };
	}
	Object.assign(connections, extraConnections);
	return { name, nodes, connections, settings: { executionOrder: 'v1' }, pinData: {} };
}

const manual = { name: 'Start', type: 'n8n-nodes-base.manualTrigger', parameters: {} };
const waitFor = (name, resource, taskId = '={{ $json.id }}') => ({
	name,
	parameters: { resource, operation: 'wait', taskId, timeoutMinutes: 15 },
});

const examples = {
	// M1: image URL in, GLB binary out.
	'm1-image-to-3d': workflow('Meshy: image to 3D GLB', [
		manual,
		{
			name: 'Create Image to 3D',
			parameters: {
				resource: 'imageTo3d',
				operation: 'create',
				inputType: 'url',
				sourceUrl: 'https://cdn.meshy.ai/webapp-assets/doc/image-to-3d-p0-1.webp',
				aiModel: 'meshy-6-lite',
				additionalFields: { shouldTexture: false },
			},
		},
		waitFor('Wait for Model', 'imageTo3d'),
		{
			name: 'Download GLB',
			parameters: {
				resource: 'imageTo3d',
				operation: 'download',
				downloadSource: 'item',
				format: 'glb',
				binaryPropertyOutput: 'data',
			},
		},
	]),

	// 0.2.0: the same job as M1 in one Meshy node, using Stop After.
	'one-node-image-to-3d': workflow('Meshy: image to 3D GLB in one node', [
		manual,
		{
			name: 'Image to 3D GLB',
			parameters: {
				resource: 'imageTo3d',
				operation: 'create',
				inputType: 'url',
				sourceUrl: 'https://cdn.meshy.ai/webapp-assets/doc/image-to-3d-p0-1.webp',
				aiModel: 'meshy-6-lite',
				additionalFields: { shouldTexture: false },
				stopAfter: 'downloaded',
				timeoutMinutes: 15,
				format: 'glb',
				binaryPropertyOutput: 'data',
			},
		},
	]),

	// M2: image to 3D, remesh, rig, animate, download FBX, chained by task id.
	'm2-rig-and-animate': workflow('Meshy: image to animated FBX', [
		manual,
		{
			name: 'Create Image to 3D',
			parameters: {
				resource: 'imageTo3d',
				operation: 'create',
				inputType: 'url',
				sourceUrl: 'https://example.com/character-t-pose.png',
				aiModel: 'meshy-6-lite',
				additionalFields: { shouldTexture: false, poseMode: 't-pose' },
			},
		},
		waitFor('Wait for Model', 'imageTo3d'),
		{
			name: 'Remesh',
			parameters: {
				resource: 'remesh',
				operation: 'create',
				inputType: 'taskId',
				inputTaskId: '={{ $json.id }}',
				additionalFields: { targetPolycount: 20000, targetFormats: ['glb'] },
			},
		},
		waitFor('Wait for Remesh', 'remesh'),
		{
			name: 'Rig',
			parameters: {
				resource: 'rigging',
				operation: 'create',
				inputType: 'taskId',
				inputTaskId: '={{ $json.id }}',
			},
		},
		waitFor('Wait for Rig', 'rigging'),
		{
			name: 'Animate',
			parameters: {
				resource: 'animation',
				operation: 'create',
				rigTaskId: '={{ $json.id }}',
				actionId: 1,
			},
		},
		waitFor('Wait for Animation', 'animation'),
		{
			name: 'Download FBX',
			parameters: {
				resource: 'animation',
				operation: 'download',
				downloadSource: 'item',
				format: 'fbx',
				binaryPropertyOutput: 'data',
			},
		},
	]),

	// M3: text to 3D preview then refine.
	'm3-text-to-3d': workflow('Meshy: text to textured 3D', [
		manual,
		{
			name: 'Preview',
			parameters: {
				resource: 'textTo3d',
				operation: 'create',
				mode: 'preview',
				prompt: 'a small wooden treasure chest',
				aiModel: 'meshy-6-lite',
			},
		},
		waitFor('Wait for Preview', 'textTo3d'),
		{
			name: 'Refine',
			parameters: {
				resource: 'textTo3d',
				operation: 'create',
				mode: 'refine',
				previewTaskId: '={{ $json.id }}',
				aiModel: 'latest',
			},
		},
		waitFor('Wait for Refine', 'textTo3d'),
		{
			name: 'Download GLB',
			parameters: {
				resource: 'textTo3d',
				operation: 'download',
				downloadSource: 'item',
				format: 'glb',
				binaryPropertyOutput: 'data',
			},
		},
	]),

	// M4: reusable sub-workflow. Call it with { taskType, body, format }.
	'meshy-run-task': workflow('Meshy: run task (sub-workflow)', [
		{
			name: 'When Called',
			type: 'n8n-nodes-base.executeWorkflowTrigger',
			typeVersion: 1.1,
			parameters: {
				workflowInputs: {
					values: [{ name: 'taskType' }, { name: 'body', type: 'object' }, { name: 'format' }],
				},
			},
		},
		{
			name: 'Create Task',
			parameters: {
				resource: 'task',
				taskType: '={{ $json.taskType }}',
				operation: 'create',
				requestBody: '={{ JSON.stringify($json.body) }}',
			},
		},
		{
			name: 'Wait for Task',
			parameters: {
				resource: 'task',
				taskType: "={{ $('When Called').item.json.taskType }}",
				operation: 'wait',
				taskId: '={{ $json.id }}',
				timeoutMinutes: 20,
			},
		},
		{
			name: 'Download File',
			parameters: {
				resource: 'task',
				taskType: "={{ $('When Called').item.json.taskType }}",
				operation: 'download',
				downloadSource: 'item',
				format: "={{ $('When Called').item.json.format || 'glb' }}",
				binaryPropertyOutput: 'data',
			},
		},
	]),

	// M4: the same, polling with stock nodes instead of the Wait operation.
	'meshy-run-task-polling': workflow(
		'Meshy: run task with stock polling loop (sub-workflow)',
		[
			{
				name: 'When Called',
				type: 'n8n-nodes-base.executeWorkflowTrigger',
				typeVersion: 1.1,
				position: [0, 0],
				parameters: {
					workflowInputs: {
						values: [{ name: 'taskType' }, { name: 'body', type: 'object' }, { name: 'format' }],
					},
				},
			},
			{
				name: 'Create Task',
				position: [240, 0],
				parameters: {
					resource: 'task',
					taskType: '={{ $json.taskType }}',
					operation: 'create',
					requestBody: '={{ JSON.stringify($json.body) }}',
				},
			},
			{
				name: 'Get Task',
				position: [480, 0],
				parameters: {
					resource: 'task',
					taskType: "={{ $('When Called').item.json.taskType }}",
					operation: 'get',
					taskId: "={{ $('Create Task').item.json.id }}",
				},
			},
			{
				name: 'Finished?',
				type: 'n8n-nodes-base.if',
				typeVersion: 2,
				position: [720, 0],
				noAutoConnect: true,
				parameters: {
					conditions: {
						options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
						conditions: [
							{
								id: 'terminal',
								leftValue: "={{ ['SUCCEEDED', 'FAILED', 'CANCELED'].includes($json.status) }}",
								rightValue: '',
								operator: { type: 'boolean', operation: 'true', singleValue: true },
							},
						],
						combinator: 'and',
					},
					options: {},
				},
			},
			{
				name: 'Wait 5 Seconds',
				type: 'n8n-nodes-base.wait',
				typeVersion: 1.1,
				position: [720, 200],
				noAutoConnect: true,
				parameters: { amount: 5 },
			},
			{
				name: 'Download File',
				position: [960, 0],
				parameters: {
					resource: 'task',
					taskType: "={{ $('When Called').item.json.taskType }}",
					operation: 'download',
					downloadSource: 'item',
					format: "={{ $('When Called').item.json.format || 'glb' }}",
					binaryPropertyOutput: 'data',
				},
			},
		],
		{
			'Finished?': {
				main: [
					[{ node: 'Download File', type: 'main', index: 0 }],
					[{ node: 'Wait 5 Seconds', type: 'main', index: 0 }],
				],
			},
			'Wait 5 Seconds': { main: [[{ node: 'Get Task', type: 'main', index: 0 }]] },
		},
	),

	// M5: trigger on finished tasks and download the GLB.
	'm5-trigger-download': workflow('Meshy: download models when tasks finish', [
		{
			name: 'Meshy Trigger',
			type: 'n8n-nodes-meshy.meshyTrigger',
			webhookId: '5b0e7d4a-6f1c-4c39-9a51-2d7f3e8b9c10',
			credentials: true,
			parameters: { taskTypes: ['imageTo3d', 'textTo3d'], statuses: ['SUCCEEDED'] },
		},
		{
			name: 'Download GLB',
			parameters: {
				resource: 'task',
				taskType: '={{ $json.family }}',
				operation: 'download',
				downloadSource: 'item',
				format: 'glb',
				binaryPropertyOutput: 'data',
			},
		},
	]),

	// M6: repair a model for printing, then check printability (analysis is free).
	'm6-print-repair-analyze': workflow('Meshy: repair and analyze for 3D printing', [
		manual,
		{
			name: 'Repair',
			parameters: {
				resource: 'printRepair',
				operation: 'create',
				inputType: 'taskId',
				inputTaskId: 'PASTE_A_SUCCEEDED_IMAGE_TO_3D_TASK_ID',
				additionalFields: { printerType: 'fdm', intendedPrintHeightMm: 80 },
			},
		},
		waitFor('Wait for Repair', 'printRepair'),
		{
			name: 'Analyze',
			parameters: {
				resource: 'printAnalyze',
				operation: 'create',
				inputType: 'taskId',
				inputTaskId: '={{ $json.id }}',
			},
		},
		waitFor('Wait for Analysis', 'printAnalyze'),
	]),
};

for (const [file, wf] of Object.entries(examples)) {
	for (const node of wf.nodes) delete node.noAutoConnect;
	writeFileSync(join(outDir, `${file}.json`), JSON.stringify(wf, null, '\t') + '\n');
	console.log(`examples/${file}.json`);
}
