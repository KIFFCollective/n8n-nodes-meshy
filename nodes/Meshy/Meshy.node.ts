import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { nodeProperties } from './descriptions';
import { asNodeError, runCreateBatch, runOperation, type StopAfter } from './operations';

// Programmatic style because Download returns binary data and Wait runs a polling
// loop; neither fits declarative routing.
export class Meshy implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Meshy',
		name: 'meshy',
		icon: { light: 'file:meshy.svg', dark: 'file:meshy.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Generate 3D models, textures, rigs, animations and images with the Meshy API (unofficial)',
		defaults: {
			name: 'Meshy',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'meshyApi', required: true }],
		properties: nodeProperties,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Create with "Stop After" past Task Created handles all items together, so
		// their tasks run side by side instead of one after another. Resource,
		// operation and Stop After cannot be expressions, so item 0 speaks for all.
		if (items.length) {
			const resource = this.getNodeParameter('resource', 0) as string;
			const operation = this.getNodeParameter('operation', 0) as string;
			if (operation === 'create' && resource !== 'account') {
				const stopAfter = this.getNodeParameter('stopAfter', 0, 'created') as StopAfter;
				if (stopAfter !== 'created') return [await runCreateBatch(this, resource, stopAfter)];
			}
		}

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				returnData.push(...(await runOperation(this, resource, operation, i)));
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: (error as Error).message,
							description: (error as { description?: string }).description,
						},
						pairedItem: { item: i },
					});
					continue;
				}
				throw asNodeError(this, error, i);
			}
		}

		return [returnData];
	}
}
