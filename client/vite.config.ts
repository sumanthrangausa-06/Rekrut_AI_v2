import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
		},
	},
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		chunkSizeWarningLimit: 600,
		rollupOptions: {
			output: {
				manualChunks(id: string) {
					// Vendor libraries
					if (id.includes('node_modules')) {
						if (id.includes('react-router')) return 'router'
						if (id.includes('react-dom')) return 'react-dom'
						if (id.includes('react')) return 'react'
						if (id.includes('lucide-react')) return 'icons'
						// Catch-all for any other heavy deps
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
		},
	},
})
