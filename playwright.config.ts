import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: { channel: 'msedge', headless: true },
  projects: [
    { name: 'local-editor', testIgnore: /publication\.spec\.ts/, use: { baseURL: 'http://127.0.0.1:4321' } },
    { name: 'published-build', testMatch: /publication\.spec\.ts/, use: { baseURL: 'http://127.0.0.1:4322' } },
  ],
  webServer: [
    { command: 'npm run dev -- --port 4321', url: 'http://127.0.0.1:4321/content/me/', reuseExistingServer: !process.env.CI },
    { command: 'npm run preview -- --port 4322', url: 'http://127.0.0.1:4322/content/me/', reuseExistingServer: !process.env.CI },
  ],
});
