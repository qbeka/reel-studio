import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  // Ports 5171 to 5175 belong to other projects on this machine.
  webServer: {
    command: 'pnpm exec vite preview --host 127.0.0.1 --port 5176 --strictPort',
    url: 'http://127.0.0.1:5176/',
    reuseExistingServer: false,
  },
  use: {
    baseURL: 'http://127.0.0.1:5176/',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    // Other engines run the exported viewer. The editor is a desktop authoring tool, and
    // the claim about reach applies to what viewers open.
    {
      name: 'webkit',
      testMatch: /export\.spec/,
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'firefox',
      testMatch: /export\.spec/,
      use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
