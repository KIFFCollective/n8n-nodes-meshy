import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { FAMILIES } from '../Meshy/families';
import { normalizeTask } from '../Meshy/normalize';
import { decide, emptyState, secretMatches, type DeliveryState } from './delivery';

const SECRET_HEADER = 'x-meshy-api-webhook-secret-key';

export class MeshyTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Meshy Trigger',
		name: 'meshyTrigger',
		icon: { light: 'file:../Meshy/meshy.svg', dark: 'file:../Meshy/meshy.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: 'Task updates',
		description:
			'Starts the workflow when a Meshy API task makes progress or finishes (unofficial)',
		defaults: { name: 'Meshy Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'meshyApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					"Meshy cannot register webhooks through its API. Copy the Production URL above, create a webhook at meshy.ai/developers/webhooks with it as the Payload URL, then put that webhook's secret in the Meshy credential. Every active Meshy webhook receives every API task.",
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Task Types',
				name: 'taskTypes',
				type: 'multiOptions',
				options: FAMILIES.map((f) => ({ name: f.name, value: f.value })).sort((a, b) =>
					a.name.localeCompare(b.name),
				),
				default: [],
				description: 'Only start for these task types. Leave empty for all.',
			},
			{
				displayName: 'Statuses',
				name: 'statuses',
				type: 'multiOptions',
				options: [
					{ name: 'Canceled', value: 'CANCELED' },
					{ name: 'Failed', value: 'FAILED' },
					{ name: 'In Progress', value: 'IN_PROGRESS' },
					{ name: 'Succeeded', value: 'SUCCEEDED' },
				],
				default: ['SUCCEEDED', 'FAILED', 'CANCELED'],
				description: 'Only start for these statuses. Leave empty for all.',
			},
		],
	};

	// Meshy has no API for webhook registration; the user adds the URL in the
	// Meshy dashboard by hand. These methods exist to satisfy the lifecycle and
	// do no remote work.
	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return false;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const credentials = await this.getCredentials('meshyApi');
		const secret = String(credentials.webhookSecret ?? '');
		const req = this.getRequestObject();

		if (!secretMatches(req.headers[SECRET_HEADER], secret)) {
			const res = this.getResponseObject();
			res.status(401).json({
				message: secret
					? 'Webhook secret does not match.'
					: 'No webhook secret is set in the Meshy credential, so deliveries are rejected.',
			});
			return { noWebhookResponse: true };
		}

		const task = this.getBodyData() as IDataObject;
		const familyValues = this.getNodeParameter('taskTypes', []) as string[];
		const taskTypes = FAMILIES.filter((f) => familyValues.includes(f.value)).flatMap(
			(f) => f.taskTypes,
		);
		const statuses = this.getNodeParameter('statuses', []) as string[];

		const staticData = this.getWorkflowStaticData('node');
		const state = (staticData.deliveries as DeliveryState | undefined) ?? emptyState();
		const decision = decide(state, task, { taskTypes, statuses });
		staticData.deliveries = state;

		// Always answer below 400 quickly, or Meshy retries and may deactivate the webhook.
		if (!decision.accept) return { webhookResponse: { received: true, ignored: decision.reason } };

		const type = String(task.type ?? '');
		const family = FAMILIES.find((f) =>
			f.taskTypes.some((t) => type === t || type.startsWith(`${t}-`)),
		);
		const json = normalizeTask(task, family?.value ?? type, family?.output ?? 'model');
		return { workflowData: [[{ json }]] };
	}
}
