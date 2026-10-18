import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4321', channel: 'msedge', headless: true },
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4321/content/me/',
    reuseExistingServer: !process.env.CI,
  },
});
