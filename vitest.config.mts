import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts', 'test/**/*.test.mts'],
		// Live tests spend real Meshy credits; they only run when MESHY_LIVE=1.
		exclude: ['**/node_modules/**', '**/dist/**'],
	},
});
