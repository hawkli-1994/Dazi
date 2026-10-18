import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  globalTimeout: 5 * 60_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  outputDir: '../../test-results/electron',
  reporter: [['list'], ['junit', { outputFile: '../../test-results/electron-results.xml' }]],
});
