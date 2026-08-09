import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [react()],
	test: {
		environment: 'jsdom',
		globals: true,
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
		},
	},
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		chunkSizeWarningLimit: 1200,
		rollupOptions: {
			output: {
				// Keep every dependency in one chunk. Splitting react/react-dom/router
				// apart strands `scheduler` in the catch-all chunk, which makes the
				// vendor chunks import each other; under a circular chunk graph the
				// scheduler module body evaluates before its exports object exists and
				// throws "Cannot set properties of undefined (setting 'unstable_now')",
				// so React never mounts. These chunks all load eagerly on first paint
				// anyway, so merging them costs no extra bytes.
				manualChunks(id: string) {
					if (id.includes('node_modules')) return 'vendor'
				},
				entryFileNames: 'assets/[name]-[hash].js',
				chunkFileNames: 'assets/[name]-[hash].js',
				assetFileNames: 'assets/[name]-[hash][extname]',
			},
		},
	},
	server: {
		proxy: {
			'/api': 'http://localhost:3000',
			'/csrf-token': 'http://localhost:3000',
		},
	},
})
