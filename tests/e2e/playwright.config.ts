import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const rootDir = path.resolve(__dirname, '../..');
const baseURL = process.env.ONEALERT_BASE_URL ?? 'http://127.0.0.1:8765';
const authStatePath = path.join(__dirname, '.auth', 'admin.json');

export default defineConfig({
  testDir: '.',
  globalSetup: './global-setup.ts',
  timeout: 30000,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  expect: { timeout: 10000 },
  use: {
    baseURL,
    storageState: authStatePath,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.ONEALERT_BASE_URL ? undefined : {
    command: 'python -m uvicorn backend.main:app --host 127.0.0.1 --port 8765',
    cwd: rootDir,
    url: `${baseURL}/health`,
    reuseExistingServer: true,
    timeout: 120000,
    env: {
      ...process.env,
      DEBUG: 'false',
      DISABLE_SCHEDULER: '1',
      DATABASE_URL: 'sqlite:///./e2e.db',
      SECRET_KEY: 'e2e-only-secret-key-with-at-least-32-bytes',
    },
  },
});
