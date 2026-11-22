// The task families the node supports. This file is shared by the node at runtime
// and by scripts/generate-from-openapi.ts, so keep it free of n8n imports.

/** How the main input of a create request can be given. */
export type SourceMode =
	| 'url' // a single public URL
	| 'urls' // a list of URLs
	| 'binary' // a single n8n binary property, sent as a data URI
	| 'binaries' // several binary properties, sent as data URIs
	| 'taskId'; // a prior Meshy task id

export interface SourceDef {
	/** Modes offered in the "Input Type" selector, first one is the default. */
	modes: SourceMode[];
	/** Body field for url/binary modes. */
	urlField?: string;
	/** Body field for urls/binaries modes. */
	urlsField?: string;
	/** Body field for taskId mode. */
	taskIdField?: string;
	/** What the URL points at. Images get a 20 MB limit on binary input. */
	asset: 'image' | 'model';
	/** Max number of items for list modes. */
	maxItems?: number;
}

/** How a task's output is shaped. Drives normalisation and download. */
export type OutputKind = 'model' | 'image' | 'rig' | 'animation' | 'analyze';

export interface FamilyDef {
	/** Resource value in the node UI. */
	value: string;
	/** Resource label in the node UI. */
	name: string;
	/** Singular noun used in operation actions, e.g. "image to 3D task". */
	noun: string;
	/** API path relative to the base URL. */
	path: string;
	/** Name of the request schema in openapi.yaml. */
	requestSchema: string;
	output: OutputKind;
	/** Task `type` values this family produces (used by the trigger filter). */
	taskTypes: string[];
	source?: SourceDef;
}

const modelInput = (taskIdField = 'input_task_id'): SourceDef => ({
	modes: ['taskId', 'url', 'binary'],
	urlField: 'model_url',
	taskIdField,
	asset: 'model',
});

export const FAMILIES: FamilyDef[] = [
	{
		value: 'textTo3d',
		name: 'Text to 3D',
		noun: 'text to 3D task',
		path: '/v2/text-to-3d',
		requestSchema: 'TextTo3DRequest',
		output: 'model',
		taskTypes: ['text-to-3d-preview', 'text-to-3d-refine'],
	},
	{
		value: 'imageTo3d',
		name: 'Image to 3D',
		noun: 'image to 3D task',
		path: '/v1/image-to-3d',
		requestSchema: 'ImageTo3DRequest',
		output: 'model',
		taskTypes: ['image-to-3d'],
		source: {
			modes: ['url', 'binary', 'taskId'],
			urlField: 'image_url',
			taskIdField: 'input_task_id',
			asset: 'image',
		},
	},
	{
		value: 'multiImageTo3d',
		name: 'Multi-Image to 3D',
		noun: 'multi-image to 3D task',
		path: '/v1/multi-image-to-3d',
		requestSchema: 'MultiImageTo3DRequest',
		output: 'model',
		taskTypes: ['multi-image-to-3d'],
		source: {
			modes: ['urls', 'binaries', 'taskId'],
			urlsField: 'image_urls',
			taskIdField: 'input_task_id',
			asset: 'image',
			maxItems: 4,
		},
	},
	{
		value: 'retexture',
		name: 'Retexture',
		noun: 'retexture task',
		path: '/v1/retexture',
		requestSchema: 'RetextureRequest',
		output: 'model',
		taskTypes: ['retexture'],
		source: modelInput(),
	},
	{
		value: 'remesh',
		name: 'Remesh',
		noun: 'remesh task',
		path: '/v1/remesh',
		requestSchema: 'RemeshRequest',
		output: 'model',
		taskTypes: ['remesh'],
		source: modelInput(),
	},
	{
		value: 'convert',
		name: 'Convert',
		noun: 'convert task',
		path: '/v1/convert',
		requestSchema: 'ConvertRequest',
		output: 'model',
		taskTypes: ['convert'],
		source: modelInput(),
	},
	{
		value: 'resize',
		name: 'Resize',
		noun: 'resize task',
		path: '/v1/resize',
		requestSchema: 'ResizeRequest',
		output: 'model',
		taskTypes: ['resize'],
		source: modelInput(),
	},
	{
		value: 'uvUnwrap',
		name: 'UV Unwrap',
		noun: 'UV unwrap task',
		path: '/v1/uv-unwrap',
		requestSchema: 'UvUnwrapRequest',
		output: 'model',
		taskTypes: ['uv-unwrap'],
		source: modelInput(),
	},
	{
		value: 'rigging',
		name: 'Rigging',
		noun: 'rigging task',
		path: '/v1/rigging',
		requestSchema: 'RiggingRequest',
		output: 'rig',
		taskTypes: ['rig'],
		source: modelInput(),
	},
	{
		value: 'animation',
		name: 'Animation',
		noun: 'animation task',
		path: '/v1/animations',
		requestSchema: 'AnimationRequest',
		output: 'animation',
		taskTypes: ['animate'],
	},
	{
		value: 'textToImage',
		name: 'Text to Image',
		noun: 'text to image task',
		path: '/v1/text-to-image',
		requestSchema: 'TextToImageRequest',
		output: 'image',
		taskTypes: ['text-to-image'],
	},
	{
		value: 'imageToImage',
		name: 'Image to Image',
		noun: 'image to image task',
		path: '/v1/image-to-image',
		requestSchema: 'ImageToImageRequest',
		output: 'image',
		taskTypes: ['image-to-image'],
		source: {
			modes: ['urls', 'binaries', 'taskId'],
			urlsField: 'reference_image_urls',
			taskIdField: 'input_task_id',
			asset: 'image',
			maxItems: 5,
		},
	},
	{
		value: 'printMultiColor',
		name: 'Print: Multi-Color',
		noun: 'multi-color print task',
		path: '/v1/print/multi-color',
		requestSchema: 'PrintMultiColorRequest',
		output: 'model',
		taskTypes: ['print-multi-color'],
		source: modelInput(),
	},
	{
		value: 'printSplit',
		name: 'Print: Auto Split',
		noun: 'auto split task',
		path: '/v1/print/split',
		requestSchema: 'PrintSplitRequest',
		output: 'model',
		taskTypes: ['print-split'],
	},
	{
		value: 'relief',
		name: 'Print: Relief',
		noun: 'relief task',
		path: '/v1/relief',
		requestSchema: 'ReliefRequest',
		output: 'model',
		taskTypes: ['relief'],
		source: { modes: ['url', 'binary'], urlField: 'image_url', asset: 'image' },
	},
	{
		value: 'printRepair',
		name: 'Print: Repair',
		noun: 'print repair task',
		path: '/v1/print/repair',
		requestSchema: 'PrintRepairRequest',
		output: 'model',
		taskTypes: ['print-repair'],
		source: modelInput(),
	},
	{
		value: 'printAnalyze',
		name: 'Print: Analyze',
		noun: 'printability analysis task',
		path: '/v1/print/analyze',
		requestSchema: 'PrintAnalyzeRequest',
		output: 'analyze',
		taskTypes: ['print-analyze'],
		source: modelInput(),
	},
];

export function getFamily(value: string): FamilyDef {
	const family = FAMILIES.find((f) => f.value === value);
	if (!family) throw new Error(`Unknown Meshy resource: ${value}`);
	return family;
}

/**
 * Hand-picked overrides for the generator. Keep this small: anything here is a
 * place where the OpenAPI spec alone does not give a good form.
 */
export interface FieldOverride {
	/** Show the field at the top level instead of under Additional Fields. */
	promote?: boolean;
	required?: boolean;
	/** Extra displayOptions.show conditions, e.g. { mode: ['preview'] }. */
	show?: Record<string, string[]>;
	description?: string;
	default?: string | number | boolean;
	/** Offer a free-text "Custom" choice next to the enum options. */
	allowCustom?: boolean;
	/** Leave the field out of the form entirely. */
	skip?: boolean;
}

const aiModelOverride: FieldOverride = {
	promote: true,
	allowCustom: true,
	description:
		'Model to use. Model names change often, so pick Custom to type any name Meshy accepts. See https://docs.meshy.ai/api/models.',
};

export const FIELD_OVERRIDES: Record<string, Record<string, FieldOverride>> = {
	textTo3d: {
		mode: { promote: true, required: true, default: 'preview' },
		prompt: { promote: true, required: true, show: { mode: ['preview'] } },
		preview_task_id: {
			promote: true,
			required: true,
			show: { mode: ['refine'] },
			description: 'ID of the succeeded preview task to texture',
		},
		ai_model: aiModelOverride,
	},
	imageTo3d: { ai_model: aiModelOverride },
	multiImageTo3d: { ai_model: aiModelOverride },
	retexture: {
		text_style_prompt: { promote: true },
		ai_model: aiModelOverride,
	},
	animation: {
		action_id: {
			promote: true,
			description:
				'Library animation to apply. Use the Get Library operation to list IDs. Ignored when Action IDs or Motion Task ID is set.',
		},
	},
	textToImage: { ai_model: { ...aiModelOverride, default: 'nano-banana' } },
	imageToImage: { ai_model: { ...aiModelOverride, default: 'nano-banana' } },
};
