import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@handclip/shared': fileURLToPath(
        new URL('../../dist/libs/shared/src/index.js', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
  },
});
