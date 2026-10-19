import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:5199',
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
