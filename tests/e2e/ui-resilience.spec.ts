import { expect, test, type Page } from '@playwright/test';

const BASE_URL = process.env.ONEALERT_BASE_URL ?? 'http://127.0.0.1:8765';

async function loginAsAdmin(page: Page) {
  await page.goto(`${BASE_URL}/app/`);
  await expect(page).toHaveURL(/\/app\/?$/, { timeout: 15_000 });
}

test.describe('Mission Control shell', () => {
  test('groups dense navigation by operational intent', async ({ page }) => {
    await loginAsAdmin(page);

    await expect(page.getByRole('banner')).toBeVisible();
    const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
    await expect(navigation.getByText('Command', { exact: true })).toBeVisible();
    await expect(navigation.getByText('Observe', { exact: true })).toBeVisible();
    await expect(navigation.getByText('Analyze', { exact: true })).toBeVisible();
    await expect(navigation.getByText('Act', { exact: true })).toBeVisible();
    await expect(navigation.getByText('Govern', { exact: true })).toBeVisible();
  });

  test('opens and dismisses mobile navigation with the keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsAdmin(page);

    const menuButton = page.getByRole('button', { name: 'Open navigation' });
    await expect(menuButton).toBeVisible();
    await menuButton.click();
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).not.toBeVisible();
    await expect(menuButton).toBeFocused();
  });
});

test.describe('Non-happy paths', () => {
  test('shows the backend error envelope on failed login', async ({ page }) => {
    await page.context().clearCookies();
    await page.route('**/api/v1/auth/login', async route => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          data: null,
          error: { code: 'HTTP_401', message: 'Account credentials were rejected' },
          metadata: { request_id: 'test-request' },
        }),
      });
    });

    await page.goto(`${BASE_URL}/app/login`);
    await page.getByLabel('Email').fill('analyst@example.com');
    await page.getByLabel('Password').fill('incorrect-password');
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page.getByRole('alert')).toContainText('Account credentials were rejected');
    await expect(page).toHaveURL(/\/app\/login$/);
  });

  test('reports a partial dashboard failure instead of healthy zeroes', async ({ page }) => {
    await loginAsAdmin(page);
    await page.route('**/api/v1/alerts/stats/overview', async route => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          data: null,
          error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Alert statistics are temporarily unavailable' },
          metadata: { request_id: 'stats-down' },
        }),
      });
    });

    await page.reload();

    await expect(page.getByRole('status')).toContainText('Some live data is unavailable');
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
    await expect(page.getByText('Alert statistics are temporarily unavailable')).toBeVisible();
  });
});
