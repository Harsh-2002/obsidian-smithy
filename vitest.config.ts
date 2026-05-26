import { defineConfig } from 'vitest/config';

/**
 * Vitest config for Smithy.
 *
 * Tests live alongside source files as `*.test.ts`. We only test the
 * PURE logic — markdown walker regex, frontmatter parser, path
 * template renderer, GitHub commit base64 encoding, etc. — not the
 * Obsidian-API-coupled code (modals, settings tab) because those need
 * a running Obsidian instance to be meaningful.
 *
 * `obsidian` is aliased to a stub that mocks the small surface our
 * pure modules touch (parseYaml from obsidian, mostly).
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/main.ts',
        'src/ui/**',
        'src/commands/**',
      ],
    },
  },
  resolve: {
    alias: {
      // Stub the `obsidian` module so importing it in tests doesn't blow up.
      obsidian: new URL('./tests/obsidian-stub.ts', import.meta.url).pathname,
    },
  },
});
