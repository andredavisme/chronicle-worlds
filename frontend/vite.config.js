import { defineConfig } from 'vite'

export default defineConfig({
  base: '/chronicle-worlds/', // GitHub Pages serves under repo name
  build: {
    outDir: '../docs', // GitHub Pages serves from /docs on main branch
    emptyOutDir: true,
  },
})
