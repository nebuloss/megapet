import { defineConfig } from 'vite';

// A standalone build of the design preview. It is deliberately separate from
// the app build so nothing from here is embedded in the server binary.
export default defineConfig({
  root: 'preview',
  build: {
    target: 'es2022',
    outDir: '../preview-dist',
    emptyOutDir: true,
    // Inline every asset so the result can be published as one file.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
  },
});
