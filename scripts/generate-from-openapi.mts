// Generates the create-operation fields for every Meshy family from openapi.yaml.
// Output: nodes/Meshy/generated/fields.ts (committed; CI fails if it drifts).
//
// Run: npm run generate            (uses docs/vendor/openapi.yaml)
//      npm run generate -- --check (exit 1 if the output would change)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { titleCase } from 'title-case';
import { parse } from 'yaml';
import {
	FAMILIES,
	FIELD_OVERRIDES,
	type FieldOverride,
	type FamilyDef,
} from '../nodes/Meshy/families.ts';

const root = join(import.meta.dirname, '..');
const specPath = join(root, 'docs/vendor/openapi.yaml');
const outPath = join(root, 'nodes/Meshy/generated/fields.ts');

interface Schema {
	type?: string | string[];
	enum?: Array<string | number>;
	default?: unknown;
	description?: string;
	deprecated?: boolean;
	minimum?: number;
	maximum?: number;
	maxLength?: number;
	items?: Schema;
	properties?: Record<string, Schema>;
	required?: string[];
	$ref?: string;
}

type Kind =
	| 'string'
	| 'number'
	| 'boolean'
	| 'options'
	| 'multiOptions'
	| 'stringList'
	| 'numberList'
	| 'object';

interface BodyField {
	param: string;
	api: string;
	kind: Kind;
	top: boolean;
	allowCustom?: boolean;
	children?: BodyField[];
}

const spec = parse(readFileSync(specPath, 'utf8'));
const schemas: Record<string, Schema> = spec.components.schemas;

function resolve(s: Schema): Schema {
	if (s.$ref) return schemas[s.$ref.split('/').pop() as string];
	return s;
}

function baseType(s: Schema): string | undefined {
	if (Array.isArray(s.type)) return s.type.find((t) => t !== 'null');
	return s.type;
}

const camel = (api: string) => api.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

const WORDS: Record<string, string> = {
	url: 'URL',
	urls: 'URLs',
	id: 'ID',
	ids: 'IDs',
	pbr: 'PBR',
	uv: 'UV',
	fps: 'FPS',
	tsr: 'TSR',
	ai: 'AI',
	mm: '(mm)',
	t: 'T',
	a: 'A',
};

function displayName(api: string): string {
	return titleCase(rawDisplayName(api));
}

function rawDisplayName(api: string): string {
	return api
		.split('_')
		.map((w) => WORDS[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

// Drop the sentences in the spec that are written for AI agents rather than people.
const AGENT_SENTENCE = /^(Pick the model|For which texture model|For a game asset)/;

function cleanDescription(text: string | undefined): string {
	if (!text) return '';
	const flat = text
		.replace(/\s+/g, ' ')
		.replace(/\s*—\s*/g, ', ')
		.trim();
	const sentences = flat.split(/(?<=\.)\s+(?=[A-Z`])/).filter((s) => !AGENT_SENTENCE.test(s));
	let out = '';
	for (const s of sentences) {
		if (out && out.length + s.length > 320) break;
		out = out ? `${out} ${s}` : s;
	}
	return out;
}

const BOOLEAN_DESCRIPTIONS: Record<string, string> = {
	turbo: 'Whether to use turbo (fast) mode',
	enable_tsr: 'Whether to use the fast-mode TSR option. Only has an effect with turbo.',
	optimize_texture_seams: 'Whether to optimize texture seams in fast mode. Only has an effect with turbo.',
	alpha_thumbnail: 'Whether to also make a preview image with a transparent background',
};

/** Applies n8n's description rules: capital first letter, no period on one sentence, booleans start with "Whether". */
function polishDescription(api: string, kind: Kind, text: string): string {
	let out = text.trim();
	if (kind === 'boolean') {
		if (BOOLEAN_DESCRIPTIONS[api]) out = BOOLEAN_DESCRIPTIONS[api];
		else if (!/^Whether/.test(out)) out = `Whether to ${out.charAt(0).toLowerCase()}${out.slice(1)}`;
	}
	if (/^[a-z]/.test(out)) out = out.charAt(0).toUpperCase() + out.slice(1);
	if (out.replace('e.g.', '').split('. ').length === 1 && out.endsWith('.')) out = out.slice(0, -1);
	return out;
}

function kindOf(s: Schema): Kind | undefined {
	const t = baseType(s);
	if (s.enum) return 'options';
	if (t === 'string') return 'string';
	if (t === 'integer' || t === 'number') return 'number';
	if (t === 'boolean') return 'boolean';
	if (t === 'object') return 'object';
	if (t === 'array') {
		const items = resolve(s.items ?? {});
		if (items.enum) return 'multiOptions';
		const it = baseType(items);
		if (it === 'integer' || it === 'number') return 'numberList';
		return 'stringList';
	}
	return undefined;
}

// Same order as n8n's node-param-options-type-unsorted-items lint rule.
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

function enumOptions(values: Array<string | number>) {
	return values
		.filter((v) => v !== null)
		.map((v) => ({ name: titleCase(String(v)), value: v }))
		.sort(byName);
}

function defaultFor(kind: Kind, s: Schema, override?: FieldOverride): unknown {
	if (override?.default !== undefined) return override.default;
	if (kind === 'multiOptions') return Array.isArray(s.default) ? s.default : [];
	if (kind === 'object') return {};
	if (s.default !== undefined && s.default !== null && !Array.isArray(s.default)) return s.default;
	if (kind === 'options') return s.enum?.filter((v) => v !== null)[0] ?? '';
	if (kind === 'number') return s.minimum ?? 0;
	if (kind === 'boolean') return false;
	return '';
}

const N8N_TYPE: Record<Kind, string> = {
	string: 'string',
	number: 'number',
	boolean: 'boolean',
	options: 'options',
	multiOptions: 'multiOptions',
	stringList: 'string',
	numberList: 'string',
	object: 'collection',
};

function buildProperty(
	api: string,
	s: Schema,
	override: FieldOverride | undefined,
): Record<string, unknown> | undefined {
	const kind = kindOf(s);
	if (!kind) return undefined;
	let description = override?.description ?? cleanDescription(s.description);
	if (kind === 'stringList' || kind === 'numberList') {
		description = `${description}${description ? ' ' : ''}Separate several values with commas.`;
	}
	description = description ? polishDescription(api, kind, description) : '';
	if (description.toLowerCase() === displayName(api).toLowerCase()) description = '';
	const prop: Record<string, unknown> = {
		displayName: displayName(api),
		name: camel(api),
		type: N8N_TYPE[kind],
		default: defaultFor(kind, s, override),
	};
	if (description) prop.description = description;
	if (kind === 'options') {
		const options = enumOptions(s.enum ?? []);
		if (override?.allowCustom) options.push({ name: 'Custom', value: '__custom' });
		prop.options = options.sort(byName);
	}
	if (kind === 'multiOptions') prop.options = enumOptions(resolve(s.items ?? {}).enum ?? []);
	if (kind === 'number') {
		const typeOptions: Record<string, number> = {};
		if (s.minimum !== undefined) typeOptions.minValue = s.minimum;
		if (s.maximum !== undefined) typeOptions.maxValue = s.maximum;
		if (baseType(s) === 'number') typeOptions.numberPrecision = 2;
		if (Object.keys(typeOptions).length) prop.typeOptions = typeOptions;
	}
	if (kind === 'string' && (s.maxLength ?? 0) > 200) prop.typeOptions = { rows: 3 };
	if (kind === 'object') {
		prop.placeholder = 'Add Option';
		prop.options = Object.entries(s.properties ?? {})
			.filter(([, child]) => !child.deprecated)
			.map(([childApi, child]) => buildProperty(childApi, resolve(child), undefined))
			.filter(Boolean)
			.sort((a, b) => String(a!.displayName).localeCompare(String(b!.displayName)));
	}
	return prop;
}

function bodyField(api: string, s: Schema, top: boolean, override?: FieldOverride): BodyField {
	const kind = kindOf(s) as Kind;
	const field: BodyField = { param: camel(api), api, kind, top };
	if (override?.allowCustom) field.allowCustom = true;
	if (kind === 'object') {
		field.children = Object.entries(s.properties ?? {})
			.filter(([, child]) => !child.deprecated)
			.map(([childApi, child]) => bodyField(childApi, resolve(child), false));
	}
	return field;
}

/** Body fields the hand-written source selector owns. */
function sourceFields(family: FamilyDef): Set<string> {
	const src = family.source;
	return new Set([src?.urlField, src?.urlsField, src?.taskIdField].filter(Boolean) as string[]);
}

const createFields: Record<string, unknown[]> = {};
const bodyFields: Record<string, BodyField[]> = {};

for (const family of FAMILIES) {
	const schema = schemas[family.requestSchema];
	if (!schema) throw new Error(`Schema ${family.requestSchema} not found in openapi.yaml`);
	const overrides = FIELD_OVERRIDES[family.value] ?? {};
	const owned = sourceFields(family);
	const required = new Set(schema.required ?? []);
	const show = { resource: [family.value], operation: ['create'] };

	const top: unknown[] = [];
	const extra: Array<Record<string, unknown>> = [];
	const fields: BodyField[] = [];

	for (const [api, raw] of Object.entries(schema.properties ?? {})) {
		const s = resolve(raw);
		const override = overrides[api];
		if (s.deprecated || override?.skip || owned.has(api)) continue;
		const isTop = Boolean(override?.promote || required.has(api));
		const prop = buildProperty(api, s, override);
		if (!prop) continue;
		fields.push(bodyField(api, s, isTop, override));

		if (isTop) {
			if (override?.required ?? required.has(api)) prop.required = true;
			prop.displayOptions = { show: { ...show, ...(override?.show ?? {}) } };
			top.push(prop);
			if (override?.allowCustom) {
				top.push({
					displayName: `Custom ${displayName(api)}`,
					name: `custom${camel(api).charAt(0).toUpperCase()}${camel(api).slice(1)}`,
					type: 'string',
					required: true,
					default: '',
					placeholder: 'e.g. meshy-7.1',
					description: 'Any model name Meshy accepts',
					displayOptions: { show: { ...show, [camel(api)]: ['__custom'] } },
				});
			}
		} else {
			extra.push(prop);
		}
	}

	extra.sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
	if (extra.length) {
		top.push({
			displayName: 'Additional Fields',
			name: 'additionalFields',
			type: 'collection',
			placeholder: 'Add Field',
			default: {},
			displayOptions: { show },
			options: extra,
		});
	}
	createFields[family.value] = top;
	bodyFields[family.value] = fields;
}

const banner = `// GENERATED by scripts/generate-from-openapi.mts from docs/vendor/openapi.yaml.
// Do not edit by hand. Change families.ts or the generator, then run: npm run generate
`;

const output = `${banner}
import type { INodeProperties } from 'n8n-workflow';

export type BodyFieldKind = ${[...new Set(Object.keys(N8N_TYPE))].map((k) => `'${k}'`).join(' | ')};

export interface BodyField {
	/** n8n parameter name */
	param: string;
	/** API body field name */
	api: string;
	kind: BodyFieldKind;
	/** true when the field is a top-level parameter, false when under Additional Fields */
	top: boolean;
	allowCustom?: boolean;
	children?: BodyField[];
}

export const createFields: Record<string, INodeProperties[]> = ${JSON.stringify(createFields, null, '\t')};

export const bodyFields: Record<string, BodyField[]> = ${JSON.stringify(bodyFields, null, '\t')};
`;

if (process.argv.includes('--check')) {
	// Compare the exported data, not the text, so formatting by Prettier does not count as drift.
	const current = existsSync(outPath) ? await import(pathToFileURL(outPath).href) : {};
	const same =
		JSON.stringify(current.createFields) === JSON.stringify(createFields) &&
		JSON.stringify(current.bodyFields) === JSON.stringify(bodyFields);
	if (!same) {
		console.error('nodes/Meshy/generated/fields.ts is out of date. Run: npm run generate');
		process.exit(1);
	}
	console.log('Generated fields are up to date.');
} else {
	writeFileSync(outPath, output);
	console.log(`Wrote ${outPath}`);
}
