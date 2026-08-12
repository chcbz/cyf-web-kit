import { defineConfig } from 'vite'
import { resolve } from 'node:path'

const root = resolve(process.cwd(), 'scripts/juyiting/e14')

export default defineConfig({
  root,
  base: './',
  build: {
    outDir: resolve(process.cwd(), 'dist/e14-benchmark'),
    emptyOutDir: true,
    minify: 'terser',
    sourcemap: false,
    target: 'es2022',
    rollupOptions: { input: resolve(root, 'index.html') },
  },
})
