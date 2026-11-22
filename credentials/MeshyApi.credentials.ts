import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class MeshyApi implements ICredentialType {
	name = 'meshyApi';

	displayName = 'Meshy API';

	icon = { light: 'file:../nodes/Meshy/meshy.svg', dark: 'file:../nodes/Meshy/meshy.dark.svg' } as const;

	documentationUrl = 'https://docs.meshy.ai/api/authentication';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'msy_...',
			description: 'Create a key at https://www.meshy.ai/settings/api',
		},
		{
			displayName: 'Webhook Secret',
			name: 'webhookSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Only needed for the Meshy Trigger node. Copy it from the webhook you created at https://www.meshy.ai/developers/webhooks.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.meshy.ai/openapi',
			url: '/v1/balance',
			method: 'GET',
		},
	};
}
