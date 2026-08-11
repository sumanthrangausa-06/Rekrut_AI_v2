import path from 'node:path'
import react from '@vitejs/plugin-react'
import compression from 'vite-plugin-compression'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [
		react(),
		// Generate .gz files for all assets
		compression({
			algorithm: 'gzip',
			ext: '.gz',
			threshold: 1024,
			deleteOriginFile: false,
		}),
		// Generate .br files for all assets
		compression({
			algorithm: 'brotliCompress',
			ext: '.br',
			threshold: 1024,
			deleteOriginFile: false,
		}),
	],
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
		chunkSizeWarningLimit: 500,
		rollupOptions: {
			output: {
				manualChunks(id: string) {
					if (id.includes('node_modules')) {
						// React ecosystem must stay together to avoid circular chunk issues
						// (scheduler needs to load before react-dom, etc.)
						if (
							id.includes('node_modules/react') ||
							id.includes('node_modules/react-dom') ||
							id.includes('node_modules/react-router') ||
							id.includes('node_modules/scheduler') ||
							id.includes('node_modules/@remix-run')
						) {
							return 'vendor-react'
						}
						// Lucide icons are large — split them out to keep vendor-react small
						if (id.includes('node_modules/lucide-react')) {
							return 'vendor-icons'
						}
						// DnD kit is only used in one feature area
						if (id.includes('node_modules/@dnd-kit')) {
							return 'vendor-dnd'
						}
						// Remaining node_modules
						return 'vendor'
					}
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
