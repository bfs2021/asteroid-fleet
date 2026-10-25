import { defineConfig, devices } from '@playwright/test';

const port = 4173;

export default defineConfig({
  testDir: 'e2e',
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${port}/asteroid-fleet/`,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm run preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/asteroid-fleet/`,
    reuseExistingServer: !process.env.CI,
  },
});
