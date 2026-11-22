// Pulls example task objects out of the vendored Meshy docs into test fixtures.
// The docs examples are public and already scrubbed (signed URL parts are "***"),
// so they are safe to commit. Run: node scripts/extract-fixtures.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const text = readFileSync(join(root, 'docs/vendor/llms-full.txt'), 'utf8');
const outDir = join(root, 'test/fixtures');
mkdirSync(outDir, { recursive: true });

// docs slug -> family key used by the node
const sections = {
	'text-to-3d': 'text-to-3d',
	'image-to-3d': 'image-to-3d',
	'multi-image-to-3d': 'multi-image-to-3d',
	remesh: 'remesh',
	convert: 'convert',
	resize: 'resize',
	'uv-unwrap': 'uv-unwrap',
	rigging: 'rigging',
	animation: 'animations',
	retexture: 'retexture',
	'text-to-image': 'text-to-image',
	'image-to-image': 'image-to-image',
	'multi-color-print': 'print-multi-color',
	'analyze-printability': 'print-analyze',
	'repair-printability': 'print-repair',
	'auto-split': 'print-split',
	relief: 'relief',
	balance: 'balance',
	usage: 'usage',
	'animation-library': 'animation-library',
};

const starts = [...text.matchAll(/^Source: https:\/\/docs\.meshy\.ai\/api\/([a-z0-9-]+)$/gm)];

for (let i = 0; i < starts.length; i++) {
	const slug = starts[i][1];
	const family = sections[slug];
	if (!family) continue;
	const body = text.slice(starts[i].index, starts[i + 1]?.index ?? text.length);

	const blocks = [];
	for (const m of body.matchAll(/```json\n([\s\S]*?)```/g)) {
		try {
			blocks.push(JSON.parse(m[1]));
		} catch {
			// Many doc blocks are request bodies with placeholders. Skip them.
		}
	}

	const isTask = (b) => b && typeof b === 'object' && !Array.isArray(b) && b.id && b.status;
	const succeeded = blocks.filter((b) => isTask(b) && b.status === 'SUCCEEDED');
	const created = blocks.find((b) => b && typeof b.result === 'string');
	const list = blocks.find((b) => Array.isArray(b) && b.length > 0);

	const written = [];
	const save = (name, data) => {
		// Scrub account ids embedded in asset paths (SPEC section 8).
		const json = JSON.stringify(data, null, '\t').replace(/(assets\.meshy\.ai\/)[0-9a-f-]{36}\//g, '$1***/');
		writeFileSync(join(outDir, `${family}.${name}.json`), json + '\n');
		written.push(name);
	};
	// Use the richest succeeded example (most keys) as the "get" fixture.
	if (succeeded.length) save('get', succeeded.sort((a, b) => Object.keys(b).length - Object.keys(a).length)[0]);
	if (created) save('create', created);
	if (list) save('list', list);
	if (!succeeded.length && !list) {
		const obj = blocks.find((b) => b && typeof b === 'object' && !Array.isArray(b) && !b.result);
		if (obj) save('get', obj);
	}
	console.log(`${family}: ${written.join(', ') || 'nothing found'}`);
}
