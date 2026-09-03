import { defineConfig } from 'vitest/config';

// The mechanism library is plain maths, so it runs in Node with no DOM.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
