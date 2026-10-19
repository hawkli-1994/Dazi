import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  timeout: 90_000,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  outputDir: '../../test-results/package',
  reporter: [['list'], ['junit', { outputFile: '../../test-results/package-results.xml' }]],
});
