import { request, type FullConfig } from '@playwright/test';
import path from 'node:path';

export const AUTH_STATE_PATH = path.join(__dirname, '.auth', 'admin.json');

export default async function globalSetup(config: FullConfig) {
  const baseURL = String(config.projects[0].use.baseURL);
  const context = await request.newContext({ baseURL });
  const response = await context.post('/api/v1/auth/login', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: 'username=admin@example.com&password=password123',
  });
  if (!response.ok()) throw new Error(`E2E authentication failed: ${response.status()} ${await response.text()}`);
  await context.storageState({ path: AUTH_STATE_PATH });
  await context.dispose();
}
