import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  assetsInclude: ['**/*.glb', '**/*.ktx2', '**/*.wasm'],
});
