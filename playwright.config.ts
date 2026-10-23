import { defineConfig } from '@playwright/test';

// The browser tests run against the built site, the way it is deployed. Locally they use the installed Chrome; in CI the
// workflow installs Playwright's own Chromium first.
export default defineConfig({
  testDir: 'web/e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'web/e2e/report' }]],
  outputDir: 'web/e2e/results',
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 720 },
    channel: process.env.CI ? undefined : 'chrome',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] },
  },
  webServer: {
    command: 'bun run build && bun run preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: true,
  },
});
