// Index of the JSON fixtures extracted from the Meshy docs (scripts/extract-fixtures.mjs).
// Static imports keep the tests free of fs access.
import type { IDataObject } from 'n8n-workflow';
import f0 from './fixtures/animations.create.json';
import f1 from './fixtures/animations.get.json';
import f2 from './fixtures/animations.list.json';
import f3 from './fixtures/balance.get.json';
import f4 from './fixtures/convert.create.json';
import f5 from './fixtures/convert.get.json';
import f6 from './fixtures/convert.list.json';
import f7 from './fixtures/image-to-3d.create.json';
import f8 from './fixtures/image-to-3d.get.json';
import f9 from './fixtures/image-to-3d.list.json';
import f10 from './fixtures/image-to-image.create.json';
import f11 from './fixtures/image-to-image.get.json';
import f12 from './fixtures/image-to-image.list.json';
import f13 from './fixtures/multi-image-to-3d.create.json';
import f14 from './fixtures/multi-image-to-3d.get.json';
import f15 from './fixtures/multi-image-to-3d.list.json';
import f16 from './fixtures/print-analyze.create.json';
import f17 from './fixtures/print-analyze.get.json';
import f18 from './fixtures/print-analyze.list.json';
import f19 from './fixtures/print-multi-color.create.json';
import f20 from './fixtures/print-multi-color.get.json';
import f21 from './fixtures/print-multi-color.list.json';
import f22 from './fixtures/print-repair.create.json';
import f23 from './fixtures/print-repair.get.json';
import f24 from './fixtures/print-repair.list.json';
import f25 from './fixtures/print-split.create.json';
import f26 from './fixtures/print-split.get.json';
import f27 from './fixtures/print-split.list.json';
import f28 from './fixtures/relief.create.json';
import f29 from './fixtures/relief.get.json';
import f30 from './fixtures/relief.list.json';
import f31 from './fixtures/remesh.create.json';
import f32 from './fixtures/remesh.get.json';
import f33 from './fixtures/remesh.list.json';
import f34 from './fixtures/resize.create.json';
import f35 from './fixtures/resize.get.json';
import f36 from './fixtures/resize.list.json';
import f37 from './fixtures/retexture.create.json';
import f38 from './fixtures/retexture.get.json';
import f39 from './fixtures/retexture.list.json';
import f40 from './fixtures/rigging.create.json';
import f41 from './fixtures/rigging.get.json';
import f42 from './fixtures/text-to-3d.create.json';
import f43 from './fixtures/text-to-3d.get.json';
import f44 from './fixtures/text-to-3d.list.json';
import f45 from './fixtures/text-to-image.create.json';
import f46 from './fixtures/text-to-image.get.json';
import f47 from './fixtures/text-to-image.list.json';
import f48 from './fixtures/usage.list.json';
import f49 from './fixtures/uv-unwrap.create.json';
import f50 from './fixtures/uv-unwrap.get.json';

const ALL: Record<string, unknown> = {
	'animations.create': f0,
	'animations.get': f1,
	'animations.list': f2,
	'balance.get': f3,
	'convert.create': f4,
	'convert.get': f5,
	'convert.list': f6,
	'image-to-3d.create': f7,
	'image-to-3d.get': f8,
	'image-to-3d.list': f9,
	'image-to-image.create': f10,
	'image-to-image.get': f11,
	'image-to-image.list': f12,
	'multi-image-to-3d.create': f13,
	'multi-image-to-3d.get': f14,
	'multi-image-to-3d.list': f15,
	'print-analyze.create': f16,
	'print-analyze.get': f17,
	'print-analyze.list': f18,
	'print-multi-color.create': f19,
	'print-multi-color.get': f20,
	'print-multi-color.list': f21,
	'print-repair.create': f22,
	'print-repair.get': f23,
	'print-repair.list': f24,
	'print-split.create': f25,
	'print-split.get': f26,
	'print-split.list': f27,
	'relief.create': f28,
	'relief.get': f29,
	'relief.list': f30,
	'remesh.create': f31,
	'remesh.get': f32,
	'remesh.list': f33,
	'resize.create': f34,
	'resize.get': f35,
	'resize.list': f36,
	'retexture.create': f37,
	'retexture.get': f38,
	'retexture.list': f39,
	'rigging.create': f40,
	'rigging.get': f41,
	'text-to-3d.create': f42,
	'text-to-3d.get': f43,
	'text-to-3d.list': f44,
	'text-to-image.create': f45,
	'text-to-image.get': f46,
	'text-to-image.list': f47,
	'usage.list': f48,
	'uv-unwrap.create': f49,
	'uv-unwrap.get': f50,
};

/** Family value in the node -> fixture file prefix. */
export const FIXTURE_NAMES: Record<string, string> = {
	textTo3d: 'text-to-3d',
	imageTo3d: 'image-to-3d',
	multiImageTo3d: 'multi-image-to-3d',
	retexture: 'retexture',
	remesh: 'remesh',
	convert: 'convert',
	resize: 'resize',
	uvUnwrap: 'uv-unwrap',
	rigging: 'rigging',
	animation: 'animations',
	textToImage: 'text-to-image',
	imageToImage: 'image-to-image',
	printMultiColor: 'print-multi-color',
	printSplit: 'print-split',
	relief: 'relief',
	printRepair: 'print-repair',
	printAnalyze: 'print-analyze',
};

export function loadFixture(name: string, kind: 'get' | 'create' | 'list'): IDataObject {
	const data = ALL[`${name}.${kind}`];
	if (!data) throw new Error(`Missing fixture ${name}.${kind}.json`);
	return data as IDataObject;
}

export function loadList(name: string): IDataObject[] {
	return (ALL[`${name}.list`] ?? []) as IDataObject[];
}
