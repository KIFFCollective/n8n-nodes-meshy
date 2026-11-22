// Checks what `npm pack` would publish: the built nodes and credential must be
// there, and dev-only files must not. Run after `npm run build`.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [pack] = JSON.parse(execSync('npm pack --dry-run --json', { encoding: 'utf8' }));
const files = pack.files.map((f) => f.path.split(String.fromCharCode(92)).join("/"));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

const problems = [];
for (const entry of [...pkg.n8n.nodes, ...pkg.n8n.credentials]) {
	if (!files.includes(entry)) problems.push(`missing ${entry}`);
}
for (const icon of ['dist/nodes/Meshy/meshy.svg', 'dist/nodes/Meshy/meshy.dark.svg']) {
	if (!files.includes(icon)) problems.push(`missing ${icon}`);
}
for (const f of files) {
	if (/^(test|scripts|docs|examples|src)\//.test(f) || /\.env/.test(f) || /\.test\./.test(f)) problems.push(`should not ship ${f}`);
}
if (Object.keys(pkg.dependencies ?? {}).length) problems.push('package has runtime dependencies');

if (problems.length) {
	console.error(`Pack check failed:\n  ${problems.join('\n  ')}`);
	process.exit(1);
}
console.log(`Pack check passed: ${files.length} files, ${(pack.size / 1024).toFixed(0)} KB packed.`);
