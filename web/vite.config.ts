import { defineConfig } from 'vite';

// The dev server proxies the API to a locally running megapetd so the
// frontend can be iterated on without rebuilding the Go binary.
const backend = process.env.MEGAPET_BACKEND ?? 'http://127.0.0.1:8080';

export default defineConfig({
  build: {
    target: 'es2022',
    cssTarget: 'chrome111',
    sourcemap: false,
    reportCompressedSize: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: false },
      '/healthz': { target: backend, changeOrigin: false },
    },
  },
});
