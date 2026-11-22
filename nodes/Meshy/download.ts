import type { IDataObject } from 'n8n-workflow';

/** Formats offered by the Download operation. Not every task has every format. */
export const DOWNLOAD_FORMATS = [
	'glb',
	'fbx',
	'obj',
	'mtl',
	'usdz',
	'stl',
	'3mf',
	'gltf',
	'blend',
	'vox',
	'pre_remeshed_glb',
	'thumbnail',
	'image',
	'depth_map',
] as const;

export type DownloadFormat = (typeof DOWNLOAD_FORMATS)[number];

export class DownloadError extends Error {}

/** The fields of a normalised task that Download reads. */
export interface DownloadSource {
	id?: string;
	name?: string | null;
	model_urls?: Record<string, string>;
	thumbnail_url?: string | null;
	image_urls?: string[];
	raw?: IDataObject;
}

export function pickUrl(task: DownloadSource, format: DownloadFormat, imageIndex = 0): string {
	let url: string | undefined | null;
	if (format === 'thumbnail') url = task.thumbnail_url;
	else if (format === 'image') url = task.image_urls?.[imageIndex];
	else if (format === 'depth_map') url = task.raw?.depth_map_url as string | undefined;
	else url = task.model_urls?.[format];

	if (!url) {
		const available = Object.keys(task.model_urls ?? {});
		const hint = available.length ? ` Available formats: ${available.join(', ')}.` : '';
		throw new DownloadError(
			`Task ${task.id ?? ''} has no "${format}" output.${hint} Only formats Meshy produced are present, and assets expire after 3 days on most plans.`,
		);
	}
	return url;
}

/**
 * Only fetch https URLs on Meshy's own hosts unless the user opts out. The URL
 * should always come from the API, but item data can be edited upstream, and we
 * do not want this node to become a general-purpose fetcher.
 */
export function assertSafeUrl(url: string, allowAnyHost: boolean): URL {
	if (!URL.canParse(url)) throw new DownloadError(`Not a valid URL: ${url}`);
	const parsed = new URL(url);
	if (parsed.protocol !== 'https:') throw new DownloadError('Downloads must use https.');
	const host = parsed.hostname.toLowerCase();
	if (!allowAnyHost && host !== 'meshy.ai' && !host.endsWith('.meshy.ai')) {
		throw new DownloadError(
			`Refusing to download from ${host}. Meshy assets come from meshy.ai hosts. Turn on "Allow Any HTTPS Host" if you trust this URL.`,
		);
	}
	return parsed;
}

const EXTENSIONS: Partial<Record<DownloadFormat, string>> = {
	pre_remeshed_glb: 'glb',
	depth_map: 'png',
};

export function fileNameFor(task: DownloadSource, format: DownloadFormat, url: URL): string {
	const fromPath = url.pathname.split('.').pop()?.toLowerCase();
	let ext = EXTENSIONS[format] ?? format;
	if (format === 'thumbnail' || format === 'image')
		ext = fromPath && /^[a-z0-9]{2,5}$/.test(fromPath) ? fromPath : 'png';
	const base = (task.name || task.id || 'meshy').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 100);
	const suffix =
		format === 'pre_remeshed_glb' ? '_pre_remeshed' : format === 'thumbnail' ? '_thumbnail' : '';
	return `${base}${suffix}.${ext}`;
}

const MIME: Record<string, string> = {
	glb: 'model/gltf-binary',
	gltf: 'model/gltf+json',
	fbx: 'application/octet-stream',
	obj: 'model/obj',
	mtl: 'model/mtl',
	usdz: 'model/vnd.usdz+zip',
	stl: 'model/stl',
	'3mf': 'model/3mf',
	blend: 'application/octet-stream',
	vox: 'application/octet-stream',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
};

export function mimeFor(fileName: string, headerType?: string): string {
	const ext = fileName.split('.').pop() ?? '';
	// Prefer our map for 3D formats: storage often labels them application/octet-stream.
	if (MIME[ext] && MIME[ext] !== 'application/octet-stream') return MIME[ext];
	if (headerType && !headerType.startsWith('application/octet-stream'))
		return headerType.split(';')[0];
	return MIME[ext] ?? 'application/octet-stream';
}
