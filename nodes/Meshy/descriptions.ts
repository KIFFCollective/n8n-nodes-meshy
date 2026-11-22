import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';
import { FAMILIES, type FamilyDef, type SourceMode } from './families';
import { createFields } from './generated/fields';
import { DOWNLOAD_FORMATS } from './download';
import { DEFAULT_WAIT_MINUTES, MAX_WAIT_MINUTES } from './wait';

const familyValues = FAMILIES.map((f) => f.value);
/** Families plus the generic "Any Task Type" resource, which shares the task operations. */
const taskResources = [...familyValues, 'task'];

export const resourceProperty: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: [
		{ name: 'Account', value: 'account' },
		{ name: 'Any Task Type', value: 'task' },
		...FAMILIES.map((f) => ({ name: f.name, value: f.value })),
	].sort((a, b) => a.name.localeCompare(b.name)),
	default: 'imageTo3d',
};

function taskOperations(family: FamilyDef): INodePropertyOptions[] {
	const n = family.noun;
	const ops: INodePropertyOptions[] = [
		{
			name: 'Cancel',
			value: 'cancel',
			description: 'Cancel a task that is still PENDING. Running tasks cannot be canceled.',
			action: `Cancel a ${n}`,
		},
		{
			name: 'Create',
			value: 'create',
			description:
				'Start a task and return its ID right away. Credits are charged now. Do not turn on Retry On Fail: Meshy has no idempotency key, so a retry can create and bill a second task.',
			action: `Create a ${n}`,
		},
		{
			name: 'Download',
			value: 'download',
			description:
				'Download a result file into binary data. Meshy keeps generated files for 3 days on non-Enterprise plans, so download soon after the task succeeds.',
			action: `Download a ${n} result`,
		},
		{ name: 'Get', value: 'get', description: 'Get a task by ID', action: `Get a ${n}` },
		{
			name: 'Get Many',
			value: 'getAll',
			description: 'List tasks, newest first',
			action: `Get many ${n}s`,
		},
		{
			name: 'Wait',
			value: 'wait',
			description: 'Poll a task until it succeeds, fails, or is canceled',
			action: `Wait for a ${n}`,
		},
	];
	if (family.value === 'animation') {
		ops.splice(4, 0, {
			name: 'Get Library',
			value: 'getLibrary',
			description: 'List the preset animations you can apply. Free.',
			action: 'Get the animation library',
		});
	}
	return ops;
}

export const operationProperties: INodeProperties[] = [
	...FAMILIES.map(
		(family): INodeProperties => ({
			displayName: 'Operation',
			name: 'operation',
			type: 'options',
			noDataExpression: true,
			displayOptions: { show: { resource: [family.value] } },
			options: taskOperations(family),
			default: 'create',
		}),
	),
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['task'] } },
		options: taskOperations({ value: 'task', noun: 'task' } as FamilyDef),
		default: 'wait',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['account'] } },
		options: [
			{
				name: 'Get Balance',
				value: 'getBalance',
				description: 'Get the credit balance',
				action: 'Get the credit balance',
			},
			{
				name: 'Get Usage',
				value: 'getUsage',
				description: 'List the credits used per task. Needs a Studio or Enterprise team key.',
				action: 'Get credit usage',
			},
		],
		default: 'getBalance',
	},
];

const MODE_LABELS: Record<SourceMode, string> = {
	url: 'URL',
	urls: 'URLs',
	binary: 'Binary File',
	binaries: 'Binary Files',
	taskId: 'Previous Task',
};

function sourceProperties(family: FamilyDef): INodeProperties[] {
	const src = family.source;
	if (!src) return [];
	const show = { resource: [family.value], operation: ['create'] };
	const what = src.asset === 'image' ? 'image' : 'model';
	const defaultMode: string = src.modes[0];
	const props: INodeProperties[] = [
		{
			displayName: 'Input Type',
			name: 'inputType',
			type: 'options',
			noDataExpression: true,
			displayOptions: { show },
			options: src.modes.map((m) => ({ name: MODE_LABELS[m], value: m })),
			default: defaultMode,
			description: `How to give Meshy the input ${what}`,
		},
	];
	const forMode = (mode: SourceMode) => ({ show: { ...show, inputType: [mode] } });

	if (src.modes.includes('url')) {
		props.push({
			displayName: what === 'image' ? 'Image URL' : 'Model URL',
			name: 'sourceUrl',
			type: 'string',
			required: true,
			default: '',
			placeholder: 'https://example.com/input.png',
			description:
				what === 'image'
					? 'Public http(s) URL or data URI of a JPG, PNG or WebP image (20 MB max)'
					: 'Public http(s) URL or data URI of the model file',
			displayOptions: forMode('url'),
		});
	}
	if (src.modes.includes('urls')) {
		props.push({
			displayName: 'Image URLs',
			name: 'sourceUrls',
			type: 'string',
			required: true,
			default: '',
			description: `Up to ${src.maxItems} image URLs or data URIs, separated by commas or new lines`,
			displayOptions: forMode('urls'),
		});
	}
	if (src.modes.includes('binary')) {
		props.push({
			displayName: 'Input Binary Field',
			name: 'binaryPropertyName',
			type: 'string',
			required: true,
			default: 'data',
			description: `Name of the binary property holding the ${what}. It is sent to Meshy as a base64 data URI.`,
			displayOptions: forMode('binary'),
		});
	}
	if (src.modes.includes('binaries')) {
		props.push({
			displayName: 'Input Binary Fields',
			name: 'binaryPropertyNames',
			type: 'string',
			required: true,
			default: 'data',
			description: `Up to ${src.maxItems} binary property names, separated by commas`,
			displayOptions: forMode('binaries'),
		});
	}
	if (src.modes.includes('taskId')) {
		props.push({
			displayName: 'Input Task ID',
			name: 'inputTaskId',
			type: 'string',
			required: true,
			default: '',
			description: 'ID of an earlier Meshy task to use as the input',
			displayOptions: forMode('taskId'),
		});
	}
	return props;
}

const taskOps = (ops: string[]) => ({ show: { resource: taskResources, operation: ops } });

const sharedTaskProperties: INodeProperties[] = [
	{
		displayName: 'Task ID',
		name: 'taskId',
		type: 'string',
		required: true,
		default: '',
		description: 'ID of the Meshy task',
		displayOptions: taskOps(['get', 'cancel', 'wait']),
	},

	// Get Many
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: {
			show: { resource: [...taskResources, 'account'], operation: ['getAll', 'getUsage'] },
		},
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: {
			show: {
				resource: [...taskResources, 'account'],
				operation: ['getAll', 'getUsage'],
				returnAll: [false],
			},
		},
	},
	{
		displayName: 'Sort',
		name: 'sortBy',
		type: 'options',
		options: [
			{ name: 'Newest First', value: '-created_at' },
			{ name: 'Oldest First', value: '+created_at' },
		],
		default: '-created_at',
		displayOptions: {
			show: { resource: [...taskResources, 'account'], operation: ['getAll', 'getUsage'] },
		},
	},

	// Download
	{
		displayName: 'Download From',
		name: 'downloadSource',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Task ID', value: 'taskId', description: 'Fetch the task, then download its file' },
			{
				name: 'Input Item',
				value: 'item',
				description:
					'Use the task data in the incoming item, for example the output of Get or Wait',
			},
		],
		default: 'taskId',
		displayOptions: taskOps(['download']),
	},
	{
		displayName: 'Task ID',
		name: 'taskId',
		type: 'string',
		required: true,
		default: '',
		description: 'ID of the Meshy task',
		displayOptions: {
			show: { resource: taskResources, operation: ['download'], downloadSource: ['taskId'] },
		},
	},
	{
		displayName: 'Format',
		name: 'format',
		type: 'options',
		options: DOWNLOAD_FORMATS.map((f) => ({
			name:
				f === 'pre_remeshed_glb'
					? 'GLB (Before Remesh)'
					: f === 'depth_map'
						? 'Depth Map (Relief)'
						: f === 'image'
							? 'Image (Image Tasks)'
							: f === 'thumbnail'
								? 'Thumbnail'
								: f.toUpperCase(),
			value: f,
		})).sort((a, b) => a.name.localeCompare(b.name)),
		default: 'glb',
		description: 'File to download. Only formats Meshy produced for the task exist.',
		displayOptions: taskOps(['download']),
	},
	{
		displayName: 'Image Index',
		name: 'imageIndex',
		type: 'number',
		typeOptions: { minValue: 0 },
		default: 0,
		description: 'Which image to download, starting at 0, when the task made several',
		displayOptions: {
			show: { resource: taskResources, operation: ['download'], format: ['image'] },
		},
	},
	{
		displayName: 'Put Output File in Field',
		name: 'binaryPropertyOutput',
		type: 'string',
		required: true,
		default: 'data',
		description: 'Name of the binary property to write the file to',
		displayOptions: taskOps(['download']),
	},
	{
		displayName: 'Options',
		name: 'downloadOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: taskOps(['download']),
		options: [
			{
				displayName: 'Allow Any HTTPS Host',
				name: 'allowAnyHost',
				type: 'boolean',
				default: false,
				description:
					'Whether to allow downloads from hosts other than meshy.ai. Off by default for safety.',
			},
		],
	},

	// Wait
	{
		displayName: 'Timeout (Minutes)',
		name: 'timeoutMinutes',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: MAX_WAIT_MINUTES },
		default: DEFAULT_WAIT_MINUTES,
		description: `How long to wait before giving up, at most ${MAX_WAIT_MINUTES}. Giving up does not cancel the task; it keeps running on Meshy.`,
		displayOptions: taskOps(['wait']),
	},
	{
		displayName: 'Options',
		name: 'waitOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: taskOps(['wait']),
		options: [
			{
				displayName: 'Error on Failed Task',
				name: 'failOnTaskError',
				type: 'boolean',
				default: true,
				description:
					'Whether to stop with an error when the task ends as FAILED or CANCELED. Turn off to get the task as normal output instead.',
			},
		],
	},
];

const animationLibraryProperties: INodeProperties[] = [
	{
		displayName: 'Filters',
		name: 'libraryFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['animation'], operation: ['getLibrary'] } },
		options: [
			{
				displayName: 'Action IDs',
				name: 'actionIds',
				type: 'string',
				default: '',
				description: 'Only return these action IDs, separated by commas (200 max)',
			},
			{
				displayName: 'Category',
				name: 'category',
				type: 'options',
				options: ['BodyMovements', 'DailyActions', 'Dancing', 'Fighting', 'WalkAndRun'].map(
					(c) => ({
						name: c.replace(/([a-z])([A-Z])/g, '$1 $2'),
						value: c,
					}),
				),
				default: 'WalkAndRun',
			},
			{
				displayName: 'Search',
				name: 'search',
				type: 'string',
				default: '',
				description: 'Case-insensitive text match on name or key',
			},
			{
				displayName: 'Sub-Category',
				name: 'subCategory',
				type: 'string',
				default: '',
			},
		],
	},
];

const usageProperties: INodeProperties[] = [
	{
		displayName: 'Filters',
		name: 'usageFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['account'], operation: ['getUsage'] } },
		options: [
			{
				displayName: 'End Time',
				name: 'endTime',
				type: 'dateTime',
				default: '',
				description: 'End of the time window. Defaults to now.',
			},
			{
				displayName: 'Endpoints',
				name: 'endpoints',
				type: 'string',
				default: '',
				placeholder: 'image-to-3d,animate',
				description: 'Endpoint names to include, separated by commas',
			},
			{
				displayName: 'Start Time',
				name: 'startTime',
				type: 'dateTime',
				default: '',
				description: 'Start of the time window. Defaults to 30 days before the end time.',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'Failed', value: 'FAILED' },
					{ name: 'Succeeded', value: 'SUCCEEDED' },
				],
				default: 'SUCCEEDED',
			},
		],
	},
];

// "Any Task Type" lets one node handle every family, with the type set by an
// expression. Useful in reusable sub-workflows (see examples/meshy-run-task.json).
const anyTaskProperties: INodeProperties[] = [
	{
		displayName: 'Task Type',
		name: 'taskType',
		type: 'options',
		options: FAMILIES.map((f) => ({ name: f.name, value: f.value })).sort((a, b) =>
			a.name.localeCompare(b.name),
		),
		default: 'imageTo3d',
		description:
			'The kind of Meshy task. Can be set with an expression, for example from a sub-workflow input.',
		displayOptions: { show: { resource: ['task'] } },
	},
	{
		displayName: 'Request Body',
		name: 'requestBody',
		type: 'json',
		required: true,
		default: '{\n  "image_url": "https://example.com/input.png"\n}',
		description:
			'The JSON body Meshy expects for this task type, with API field names. See https://docs.meshy.ai.',
		displayOptions: { show: { resource: ['task'], operation: ['create'] } },
	},
];

export const nodeProperties: INodeProperties[] = [
	resourceProperty,
	...operationProperties,
	...FAMILIES.flatMap((f) => [...sourceProperties(f), ...(createFields[f.value] ?? [])]),
	...anyTaskProperties,
	...sharedTaskProperties,
	...animationLibraryProperties,
	...usageProperties,
];
