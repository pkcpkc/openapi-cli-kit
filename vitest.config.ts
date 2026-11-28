import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The library's items import the kit by its package name, as they do once added to a project
    alias: { 'openapi-cli-kit': fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
  },
  test: { include: ['**/*.test.ts'], exclude: ['node_modules/**', 'dist/**'] },
});
