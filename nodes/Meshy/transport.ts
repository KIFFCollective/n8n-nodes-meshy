import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, sleep } from 'n8n-workflow';

export const BASE_URL = 'https://api.meshy.ai/openapi';
export const CREDENTIAL_NAME = 'meshyApi';

/** Seconds to wait between polls when the API sends no Retry-After header. */
export const DEFAULT_RETRY_AFTER_SECONDS = 5;
const MAX_READ_RETRIES_ON_429 = 3;

type Context = IExecuteFunctions | ILoadOptionsFunctions;

export interface MeshyResponse<T = unknown> {
	body: T;
	statusCode: number;
	headers: Record<string, string | string[] | undefined>;
}

export interface MeshyRequestOptions {
	body?: IDataObject;
	qs?: IDataObject;
	/**
	 * True for calls that create a task. Meshy has no idempotency key, so these are
	 * never retried: a retry after a timeout or 5xx could create (and bill) a second task.
	 */
	isCreate?: boolean;
	headers?: Record<string, string>;
	itemIndex?: number;
	/** Injected in tests so they do not wait for real. */
	sleepFn?: (ms: number) => Promise<void>;
}

/** Reads Retry-After in seconds. Returns undefined when absent or unreadable. */
export function retryAfterSeconds(headers: MeshyResponse['headers']): number | undefined {
	const raw = headers['retry-after'] ?? headers['Retry-After'];
	const value = Array.isArray(raw) ? raw[0] : raw;
	if (value === undefined) return undefined;
	const seconds = Number(value);
	return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/** Plain-language summaries for the status codes users actually hit. */
export function describeError(statusCode: number, apiMessage: string, isCreate: boolean): string {
	const msg = apiMessage.toLowerCase();
	if (statusCode === 401)
		return 'Meshy rejected the API key. Check the key in the Meshy credential.';
	if (statusCode === 402 || msg.includes('insufficient') || msg.includes('credit')) {
		return 'Not enough Meshy credits, or your plan does not include this API.';
	}
	if (statusCode === 403)
		return 'Meshy refused the request. Content moderation, an IP allowlist, or your plan can cause this.';
	if (statusCode === 404)
		return 'Meshy could not find this task or resource. Check the ID and the resource type.';
	if (statusCode === 409) {
		return 'The task is already running, so Meshy will not cancel it. Only PENDING tasks can be canceled.';
	}
	if (statusCode === 422)
		return 'Meshy could not process the input (for example, pose estimation failed).';
	if (statusCode === 429) {
		if (msg.startsWith('nomorependingtasks') || msg.startsWith('nomoreconcurrenttasks')) {
			return 'Too many Meshy tasks are running at once. Wait for one to finish, then try again.';
		}
		return isCreate
			? 'Meshy rate limit reached. The create call was not retried, because a retry could create a second task.'
			: 'Meshy rate limit reached and retries ran out. Try again shortly.';
	}
	if (statusCode >= 500) {
		return isCreate
			? 'Meshy had a server error. The create call was not retried. Check recent tasks with Get Many before trying again, because the task may exist.'
			: 'Meshy had a server error. Try again shortly.';
	}
	if (statusCode === 400) return 'Meshy rejected the request parameters.';
	return `Meshy returned HTTP ${statusCode}.`;
}

/**
 * The 429 Meshy sends when the plan's limit on PENDING or IN_PROGRESS tasks is full.
 * Meshy checks this limit before it creates a task, so no task exists and no credits
 * were charged. `NoMoreConcurrentTasks` is not included: it means no credits are left.
 */
export function isPendingLimit(statusCode: number, apiMessage: string): boolean {
	return statusCode === 429 && apiMessage.toLowerCase().startsWith('nomorependingtasks');
}

/** Thrown for the concurrent task limit, so a batch create can wait and try again safely. */
export class PendingLimitError extends NodeApiError {}

function errorBody(body: unknown): JsonObject {
	if (body && typeof body === 'object' && !Array.isArray(body)) return body as JsonObject;
	return { message: typeof body === 'string' ? body : '' };
}

export async function meshyRequest<T = unknown>(
	this: Context,
	method: IHttpRequestMethods,
	path: string,
	options: MeshyRequestOptions = {},
): Promise<MeshyResponse<T>> {
	const wait = options.sleepFn ?? sleep;
	for (let attempt = 0; ; attempt++) {
		const response = (await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL_NAME, {
			method,
			url: `${BASE_URL}${path}`,
			body: options.body,
			qs: options.qs,
			headers: options.headers,
			json: true,
			returnFullResponse: true,
			// We read the status ourselves so 429 and error bodies can be handled here.
			ignoreHttpStatusErrors: true,
		})) as MeshyResponse<T>;

		const { statusCode } = response;
		if (statusCode < 400) return response;

		const body = errorBody(response.body);
		const apiMessage = String(body.message ?? '');
		const retryAfter = retryAfterSeconds(response.headers ?? {});

		const canRetry =
			statusCode === 429 &&
			!options.isCreate &&
			retryAfter !== undefined &&
			attempt < MAX_READ_RETRIES_ON_429;
		if (canRetry) {
			await wait(retryAfter * 1000);
			continue;
		}

		const code = body.code ? ` (code: ${String(body.code)})` : '';
		const ErrorClass = isPendingLimit(statusCode, apiMessage) ? PendingLimitError : NodeApiError;
		throw new ErrorClass(this.getNode(), body, {
			message: describeError(statusCode, apiMessage, Boolean(options.isCreate)),
			description: apiMessage ? `Meshy says: ${apiMessage}${code}` : undefined,
			httpCode: String(statusCode),
			itemIndex: options.itemIndex,
		});
	}
}
