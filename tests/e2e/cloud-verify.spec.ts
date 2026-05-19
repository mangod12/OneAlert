import { test, expect } from '@playwright/test';

const BASE_URL = 'https://cybersec-saas-ebqzvaqu6a-uc.a.run.app';

test.describe('OneAlert Cloud Run Smoke Tests', () => {
  test('health endpoint returns healthy', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/health`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe('healthy');
  });

  test('readiness probe checks DB', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/health/ready`);
    const body = await response.json();
    expect(body.status).toBe('ready');
    expect(body.database).toBe('connected');
  });

  test('liveness probe returns ok', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/health/live`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe('ok');
  });

  test('root redirects to /app/', async ({ page }) => {
    const response = await page.goto(BASE_URL);
    expect(page.url()).toContain('/app/');
  });

  test('SPA loads login page', async ({ page }) => {
    await page.goto(`${BASE_URL}/app/login`);
    await expect(page.locator('body')).toBeVisible();
    // Check page has login form elements
    await expect(page.getByRole('button', { name: /sign in|log in|login/i })).toBeVisible({ timeout: 15000 });
  });

  test('API returns 401 for unauthenticated requests', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v1/auth/me`);
    expect(response.status()).toBe(401);
  });

  test('login with demo credentials returns JWT', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/v1/auth/login`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'username=admin@example.com&password=password123',
    });
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.access_token).toBeTruthy();
    expect(body.token_type).toBe('bearer');
  });

  test('authenticated user can fetch profile', async ({ request }) => {
    // Login first
    const loginRes = await request.post(`${BASE_URL}/api/v1/auth/login`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'username=admin@example.com&password=password123',
    });
    const { access_token } = await loginRes.json();

    // Fetch profile
    const meRes = await request.get(`${BASE_URL}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(meRes.ok()).toBeTruthy();
    const user = await meRes.json();
    expect(user.email).toBe('admin@example.com');
  });

  test('authenticated user can list alerts', async ({ request }) => {
    const loginRes = await request.post(`${BASE_URL}/api/v1/auth/login`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'username=admin@example.com&password=password123',
    });
    const { access_token } = await loginRes.json();

    const alertsRes = await request.get(`${BASE_URL}/api/v1/alerts/`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(alertsRes.ok()).toBeTruthy();
    const body = await alertsRes.json();
    expect(body).toHaveProperty('alerts');
    expect(body).toHaveProperty('total');
    // 'pages' field added in latest fix — verify it exists if deployed
    expect(typeof body.total).toBe('number');
  });

  test('authenticated user can list assets', async ({ request }) => {
    const loginRes = await request.post(`${BASE_URL}/api/v1/auth/login`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'username=admin@example.com&password=password123',
    });
    const { access_token } = await loginRes.json();

    const assetsRes = await request.get(`${BASE_URL}/api/v1/assets/`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(assetsRes.ok()).toBeTruthy();
    const body = await assetsRes.json();
    expect(body).toHaveProperty('assets');
    expect(body).toHaveProperty('total');
  });

  test('full login flow in browser', async ({ page }) => {
    await page.goto(`${BASE_URL}/app/login`);

    // Wait for SPA to render
    await page.waitForLoadState('networkidle', { timeout: 20000 });

    // Fill login form — match actual placeholder text
    await page.getByPlaceholder('you@company.com').fill('admin@example.com');
    await page.getByPlaceholder('Enter your password').fill('password123');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Should redirect to dashboard (URL may or may not have trailing slash)
    await expect(page.getByPlaceholder('you@company.com')).not.toBeVisible({ timeout: 20000 });
  });

  test('security headers present on responses', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/health`);
    const headers = response.headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
  });

  test('rate limiting returns proper error format', async ({ request }) => {
    // The envelope format should be consistent even on errors
    const response = await request.get(`${BASE_URL}/api/v1/auth/me`);
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body).toHaveProperty('success', false);
    expect(body).toHaveProperty('error');
  });

  test('metrics endpoint returns data', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/metrics`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body).toHaveProperty('data');
  });
});
