import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import {
	jsonParse,
	NodeApiError,
	NodeOperationError,
	sleepUnlessExecutionCancelled,
} from 'n8n-workflow';
import {
	buildCreateBody,
	InputError,
	MAX_IMAGE_BYTES,
	splitList,
	toDataUri,
	type ParamReader,
} from './body';
import {
	assertSafeUrl,
	fileNameFor,
	mimeFor,
	pickUrl,
	type DownloadFormat,
	type DownloadSource,
} from './download';
import { runBatch, type BatchOutcome, type CreatedTask } from './batch';
import { getFamily, type FamilyDef } from './families';
import { normalizeTask, type NormalizedTask } from './normalize';
import { meshyRequest, PendingLimitError, retryAfterSeconds } from './transport';
import { MAX_WAIT_MINUTES, pollUntilTerminal, WaitTimeoutError } from './wait';

const PAGE_SIZE = 100;
const MAX_PAGES = 255; // the API rejects page_num above 255

/** Turns our own error types into n8n errors that show up properly in the UI. */
export function asNodeError(
	ctx: IExecuteFunctions,
	error: unknown,
	i: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) return error;
	if (error instanceof WaitTimeoutError) {
		return new NodeOperationError(ctx.getNode(), error.message, {
			itemIndex: i,
			description: `Task ${error.taskId} keeps running and is not charged again. Raise the timeout, or run Wait or Get later.`,
		});
	}
	return new NodeOperationError(ctx.getNode(), error as Error, { itemIndex: i });
}

function reader(ctx: IExecuteFunctions, i: number): ParamReader {
	return {
		get: (name) => ctx.getNodeParameter(name, i, null),
		async binaryToDataUri(prop, asset) {
			const meta = ctx.helpers.assertBinaryData(i, prop);
			const buffer = await ctx.helpers.getBinaryDataBuffer(i, prop);
			if (asset === 'image' && buffer.length > MAX_IMAGE_BYTES) {
				throw new InputError(
					`The image in "${prop}" is ${(buffer.length / 1048576).toFixed(1)} MB. Meshy accepts at most 20 MB.`,
				);
			}
			return toDataUri(buffer.toString('base64'), meta.mimeType);
		},
	};
}

async function fetchTask(ctx: IExecuteFunctions, family: FamilyDef, id: string, i: number) {
	const res = await meshyRequest.call(ctx, 'GET', `${family.path}/${encodeURIComponent(id)}`, {
		itemIndex: i,
	});
	return { task: res.body as IDataObject, retryAfterSeconds: retryAfterSeconds(res.headers ?? {}) };
}

/** Reads the Task ID. An empty ID would turn GET /family/{id} into the list endpoint. */
function taskIdParam(ctx: IExecuteFunctions, i: number): string {
	const id = String(ctx.getNodeParameter('taskId', i) ?? '').trim();
	if (!id) throw new NodeOperationError(ctx.getNode(), 'Task ID is empty.', { itemIndex: i });
	return id;
}

const one = (json: IDataObject, i: number): INodeExecutionData[] => [
	{ json, pairedItem: { item: i } },
];

async function listPaged(
	ctx: IExecuteFunctions,
	path: string,
	i: number,
	qs: IDataObject,
): Promise<IDataObject[]> {
	const returnAll = ctx.getNodeParameter('returnAll', i, false) as boolean;
	const limit = returnAll ? Infinity : (ctx.getNodeParameter('limit', i, 50) as number);
	const results: IDataObject[] = [];
	for (let page = 1; page <= MAX_PAGES && results.length < limit; page++) {
		const pageSize = Math.min(PAGE_SIZE, limit - results.length);
		const res = await meshyRequest.call(ctx, 'GET', path, {
			qs: { ...qs, page_num: page, page_size: pageSize },
			itemIndex: i,
		});
		const rows = Array.isArray(res.body) ? (res.body as IDataObject[]) : [];
		results.push(...rows);
		if (rows.length < pageSize) break;
	}
	return results.slice(0, limit);
}

/** Reads the raw JSON body of the "Any Task Type" resource. */
function rawBody(ctx: IExecuteFunctions, i: number): IDataObject {
	const value = ctx.getNodeParameter('requestBody', i);
	const parsed =
		typeof value === 'string' ? (jsonParse(value, { fallbackValue: undefined }) as unknown) : value;
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new InputError('Request Body must be a JSON object.');
	}
	return parsed as IDataObject;
}

/** Builds the create body for one item. Input errors are thrown before anything is sent. */
async function createBody(
	ctx: IExecuteFunctions,
	family: FamilyDef,
	i: number,
	generic: boolean,
): Promise<IDataObject> {
	try {
		return generic ? rawBody(ctx, i) : await buildCreateBody(family.value, reader(ctx, i));
	} catch (error) {
		throw asNodeError(ctx, error, i);
	}
}

/** Sends one create request. Never retried: Meshy has no idempotency key. */
async function postCreate(
	ctx: IExecuteFunctions,
	family: FamilyDef,
	body: IDataObject,
	i: number,
): Promise<string> {
	const res = await meshyRequest.call(ctx, 'POST', family.path, {
		body,
		isCreate: true,
		itemIndex: i,
	});
	return String((res.body as IDataObject)?.result ?? '');
}

export async function create(
	ctx: IExecuteFunctions,
	family: FamilyDef,
	i: number,
	generic = false,
): Promise<INodeExecutionData[]> {
	const body = await createBody(ctx, family, i, generic);
	const id = await postCreate(ctx, family, body, i);
	return one({ id, status: 'PENDING', family: family.value }, i);
}

export async function get(
	ctx: IExecuteFunctions,
	family: FamilyDef,
	i: number,
): Promise<INodeExecutionData[]> {
	const id = taskIdParam(ctx, i);
	const { task } = await fetchTask(ctx, family, id, i);
	return one(normalizeTask(task, family.value, family.output), i);
}

export async function getAll(
	ctx: IExecuteFunctions,
	family: FamilyDef,
	i: number,
): Promise<INodeExecutionData[]> {
	const sortBy = ctx.getNodeParameter('sortBy', i, '-created_at') as string;
	const rows = await listPaged(ctx, family.path, i, { sort_by: sortBy });
	return rows.map((row) => ({
		json: normalizeTask(row, family.value, family.output),
		pairedItem: { item: i },
	}));
}

export async function cancel(
	ctx: IExecuteFunctions,
	family: FamilyDef,
	i: number,
): Promise<INodeExecutionData[]> {
	const id = taskIdParam(ctx, i);
	await meshyRequest.call(ctx, 'DELETE', `${family.path}/${encodeURIComponent(id)}`, {
		itemIndex: i,
	});
	return one({ id, family: family.value, canceled: true }, i);
}

function timeoutMs(ctx: IExecuteFunctions, i: number): number {
	const minutes = Math.min(
		Math.max(ctx.getNodeParameter('timeoutMinutes', i, 10) as number, 1),
		MAX_WAIT_MINUTES,
	);
	return minutes * 60_000;
}

interface WaitSettings {
	failOnTaskError: boolean;
	returnTaskOnTimeout: boolean;
}

function waitSettings(ctx: IExecuteFunctions, i: number): WaitSettings {
	const options = ctx.getNodeParameter('waitOptions', i, {}) as IDataObject;
	return {
		failOnTaskError: options.failOnTaskError !== false,
		returnTaskOnTimeout: options.returnTaskOnTimeout === true,
	};
}

/** The error for a task that ended FAILED or CANCELED while "Error on Failed Task" is on. */
function taskEndedError(ctx: IExecuteFunctions, task: NormalizedTask, i: number) {
	const reason = task.error
		? `: ${task.error.message}${task.error.code ? ` (code: ${task.error.code})` : ''}`
		: '';
	return new NodeOperationError(
		ctx.getNode(),
		`Meshy task ${task.id} ended as ${task.status}${reason}`,
		{
			itemIndex: i,
			description:
				task.status === 'FAILED' ? 'Meshy refunds the credits for failed tasks.' : undefined,
		},
	);
}

export async function wait(
	ctx: IExecuteFunctions,
	family: FamilyDef,
	i: number,
): Promise<INodeExecutionData[]> {
	const id = taskIdParam(ctx, i);
	const settings = waitSettings(ctx, i);

	let raw: IDataObject;
	try {
		raw = await pollUntilTerminal(id, () => fetchTask(ctx, family, id, i), {
			timeoutMs: timeoutMs(ctx, i),
			sleep: (ms) => sleepUnlessExecutionCancelled(ctx, ms),
		});
	} catch (error) {
		if (error instanceof WaitTimeoutError && settings.returnTaskOnTimeout && error.lastTask) {
			return one(normalizeTask(error.lastTask, family.value, family.output), i);
		}
		throw asNodeError(ctx, error, i);
	}

	const task = normalizeTask(raw, family.value, family.output);
	if (settings.failOnTaskError && task.status !== 'SUCCEEDED') throw taskEndedError(ctx, task, i);
	return one(task, i);
}

export async function download(
	ctx: IExecuteFunctions,
	family: FamilyDef,
	i: number,
): Promise<INodeExecutionData[]> {
	const sourceMode = ctx.getNodeParameter('downloadSource', i, 'taskId') as string;

	let task: DownloadSource & IDataObject;
	if (sourceMode === 'item') {
		task = ctx.getInputData()[i].json as DownloadSource & IDataObject;
		if (!task.model_urls && !task.image_urls && !task.thumbnail_url) {
			throw new NodeOperationError(
				ctx.getNode(),
				'The input item has no model_urls, image_urls or thumbnail_url. Connect the output of a Get or Wait operation.',
				{ itemIndex: i },
			);
		}
	} else {
		const id = taskIdParam(ctx, i);
		const { task: raw } = await fetchTask(ctx, family, id, i);
		task = normalizeTask(raw, family.value, family.output);
	}

	const json: IDataObject = sourceMode === 'item' ? { ...task } : (task as NormalizedTask);
	return [await downloadTask(ctx, task, json, i)];
}

/** Downloads the file chosen by the Format parameter and attaches it to the output item. */
async function downloadTask(
	ctx: IExecuteFunctions,
	task: DownloadSource,
	json: IDataObject,
	i: number,
): Promise<INodeExecutionData> {
	const format = ctx.getNodeParameter('format', i) as DownloadFormat;
	const imageIndex = ctx.getNodeParameter('imageIndex', i, 0) as number;
	const property = ctx.getNodeParameter('binaryPropertyOutput', i, 'data') as string;
	const options = ctx.getNodeParameter('downloadOptions', i, {}) as IDataObject;

	let url: URL;
	try {
		url = assertSafeUrl(pickUrl(task, format, imageIndex), Boolean(options.allowAnyHost));
	} catch (error) {
		throw asNodeError(ctx, error, i);
	}

	// Plain request with no credential: asset URLs are pre-signed, and the API key
	// must not be sent to the storage host.
	const res = (await ctx.helpers.httpRequest({
		method: 'GET',
		url: url.toString(),
		encoding: 'arraybuffer',
		returnFullResponse: true,
	})) as { body: ArrayBuffer | Buffer; headers: Record<string, string> };

	const fileName = fileNameFor(task, format, url);
	const buffer = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body);
	const binary = await ctx.helpers.prepareBinaryData(
		buffer,
		fileName,
		mimeFor(fileName, res.headers?.['content-type']),
	);
	return { json, binary: { [property]: binary }, pairedItem: { item: i } };
}

export async function getLibrary(ctx: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const filters = ctx.getNodeParameter('libraryFilters', i, {}) as IDataObject;
	const qs: IDataObject = {};
	if (filters.search) qs.search = filters.search;
	if (filters.category) qs.category = filters.category;
	if (filters.subCategory) qs.sub_category = filters.subCategory;
	const ids = splitList(filters.actionIds);
	if (ids.length) qs.action_ids = ids.join(',');
	const res = await meshyRequest.call(ctx, 'GET', '/v1/animations/library', { qs, itemIndex: i });
	const rows = Array.isArray(res.body) ? (res.body as IDataObject[]) : [];
	return rows.map((json) => ({ json, pairedItem: { item: i } }));
}

export async function getBalance(ctx: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const res = await meshyRequest.call(ctx, 'GET', '/v1/balance', { itemIndex: i });
	return one(res.body as IDataObject, i);
}

export async function getUsage(ctx: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const filters = ctx.getNodeParameter('usageFilters', i, {}) as IDataObject;
	const qs: IDataObject = { sort_by: ctx.getNodeParameter('sortBy', i, '-created_at') };
	if (filters.startTime) qs.start_time = new Date(String(filters.startTime)).toISOString();
	if (filters.endTime) qs.end_time = new Date(String(filters.endTime)).toISOString();
	if (filters.endpoints) qs.endpoints = splitList(filters.endpoints).join(',');
	if (filters.status) qs.status = filters.status;
	const rows = await listPaged(ctx, '/v1/usage/tasks', i, qs);
	return rows.map((json) => ({ json, pairedItem: { item: i } }));
}

export async function runOperation(
	ctx: IExecuteFunctions,
	resource: string,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	if (resource === 'account') {
		if (operation === 'getBalance') return getBalance(ctx, i);
		if (operation === 'getUsage') return getUsage(ctx, i);
	} else {
		const generic = resource === 'task';
		const family = getFamily(generic ? (ctx.getNodeParameter('taskType', i) as string) : resource);
		switch (operation) {
			case 'create':
				return create(ctx, family, i, generic);
			case 'get':
				return get(ctx, family, i);
			case 'getAll':
				return getAll(ctx, family, i);
			case 'cancel':
				return cancel(ctx, family, i);
			case 'wait':
				return wait(ctx, family, i);
			case 'download':
				return download(ctx, family, i);
			case 'getLibrary':
				if (family.value === 'animation') return getLibrary(ctx, i);
		}
	}
	throw new NodeOperationError(
		ctx.getNode(),
		`Unsupported operation "${operation}" for resource "${resource}"`,
		{
			itemIndex: i,
		},
	);
}

export type StopAfter = 'created' | 'finished' | 'downloaded';

/** Lists the tasks created before an error, so none of them is lost. */
function createdList(created: CreatedTask[], itemOf: (job: number) => number): string {
	if (!created.length) return 'No tasks were created, so no credits were charged.';
	const rows = created.map((c) => `${c.taskId} (item ${itemOf(c.job)}, ${c.status})`);
	return `Tasks created in this run: ${rows.join(', ')}. They keep running on Meshy and are not charged again. Use Get or Wait with these IDs instead of running this node again.`;
}

/**
 * Create with "Stop After" set to Task Finished or File Downloaded. Works in phases
 * so a batch takes about as long as its slowest task: check every item's input,
 * create every task, poll them all, then download.
 */
export async function runCreateBatch(
	ctx: IExecuteFunctions,
	resource: string,
	stopAfter: Exclude<StopAfter, 'created'>,
): Promise<INodeExecutionData[]> {
	const items = ctx.getInputData();
	const continueOnFail = ctx.continueOnFail();
	const generic = resource === 'task';
	const results: INodeExecutionData[][] = new Array(items.length);

	const errorItem = (i: number, error: unknown, id?: string): INodeExecutionData[] => {
		const nodeError = asNodeError(ctx, error, i);
		return [
			{
				json: {
					...(id ? { id } : {}),
					error: nodeError.message,
					description: nodeError.description ?? undefined,
				},
				pairedItem: { item: i },
			},
		];
	};

	// Phase 1: check every input first, so a bad item 5 does not spend credits on items 1 to 4.
	const jobs: Array<{ i: number; family: FamilyDef; body: IDataObject }> = [];
	for (let i = 0; i < items.length; i++) {
		try {
			const family = getFamily(
				generic ? (ctx.getNodeParameter('taskType', i) as string) : resource,
			);
			jobs.push({ i, family, body: await createBody(ctx, family, i, generic) });
		} catch (error) {
			if (!continueOnFail) throw asNodeError(ctx, error, i);
			results[i] = errorItem(i, error);
		}
	}
	const itemOf = (job: number) => jobs[job].i;

	// Phase 2: create everything, then poll everything.
	let outcomes: BatchOutcome[] = [];
	if (jobs.length) {
		const result = await runBatch({
			count: jobs.length,
			create: async (job) => await postCreate(ctx, jobs[job].family, jobs[job].body, jobs[job].i),
			fetch: async (job, id) => await fetchTask(ctx, jobs[job].family, id, jobs[job].i),
			isPendingLimit: (error) => error instanceof PendingLimitError,
			stopOnError: !continueOnFail,
			// The timeout is one deadline for the whole batch, so it is read from the first item.
			timeoutMs: timeoutMs(ctx, jobs[0].i),
			sleep: async (ms) => await sleepUnlessExecutionCancelled(ctx, ms),
		});
		if (result.abort) {
			const { abort } = result;
			const i = abort.job === undefined ? jobs[0].i : itemOf(abort.job);
			const cause = asNodeError(ctx, abort.cause, i);
			throw new NodeOperationError(ctx.getNode(), cause.message, {
				itemIndex: i,
				description: [cause.description, createdList(abort.created, itemOf)]
					.filter(Boolean)
					.join(' '),
			});
		}
		outcomes = result.outcomes;
	}

	// From here on, every task ID is known. Without Continue On Fail, the first error
	// stops the node and names every task created.
	const allCreated: CreatedTask[] = outcomes.flatMap((o, job) =>
		'taskId' in o && o.taskId
			? [{ job, taskId: o.taskId, status: o.kind === 'done' ? String(o.task.status) : o.kind }]
			: [],
	);
	const stop = (error: unknown, job: number): never => {
		const i = itemOf(job);
		const cause = asNodeError(ctx, error, i);
		throw new NodeOperationError(ctx.getNode(), cause.message, {
			itemIndex: i,
			description: [cause.description, createdList(allCreated, itemOf)].filter(Boolean).join(' '),
		});
	};

	// Phase 3: build the output, downloading where asked.
	for (let job = 0; job < jobs.length; job++) {
		const { i, family } = jobs[job];
		const outcome = outcomes[job];
		const settings = waitSettings(ctx, i);
		try {
			if (outcome.kind === 'error' || outcome.kind === 'notStarted') throw outcome.error;
			if (outcome.kind === 'timeout') {
				if (settings.returnTaskOnTimeout && outcome.error.lastTask) {
					results[i] = one(normalizeTask(outcome.error.lastTask, family.value, family.output), i);
					continue;
				}
				throw outcome.error;
			}
			const task = normalizeTask(outcome.task, family.value, family.output);
			if (task.status !== 'SUCCEEDED') {
				if (settings.failOnTaskError) throw taskEndedError(ctx, task, i);
				results[i] = one(task, i);
			} else if (stopAfter === 'finished') {
				results[i] = one(task, i);
			} else {
				results[i] = [await downloadTask(ctx, task, task, i)];
			}
		} catch (error) {
			if (!continueOnFail) stop(error, job);
			const id = outcome.kind === 'notStarted' ? undefined : outcome.taskId;
			results[i] = errorItem(i, error, id);
		}
	}

	return results.flat();
}
