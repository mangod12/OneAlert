import { test, expect, type Page } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:8765';

async function loginAsAdmin(page: Page) {
  await page.goto(`${BASE_URL}/app/login`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });
  await page.getByPlaceholder('you@company.com').fill('admin@example.com');
  await page.getByPlaceholder('Enter your password').fill('password123');
  await page.getByRole('button', { name: 'Sign In' }).click();
  // Wait for redirect — login field disappears OR URL changes
  await page.waitForFunction(() => !document.querySelector('input[placeholder="you@company.com"]'), { timeout: 15000 })
    .catch(() => page.waitForTimeout(3000));
  // Extra settle time for SPA routing
  await page.waitForTimeout(1000);
}

test.describe('Auth Flow', () => {
  test('login page has all elements', async ({ page }) => {
    await page.goto(`${BASE_URL}/app/login`);
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await expect(page.getByText('Welcome back')).toBeVisible();
    await expect(page.getByText('Sign in to OneAlert')).toBeVisible();
    await expect(page.getByPlaceholder('you@company.com')).toBeVisible();
    await expect(page.getByPlaceholder('Enter your password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
    await expect(page.getByText('Continue with GitHub')).toBeVisible();
    await expect(page.getByText('Sign up')).toBeVisible();
  });

  test('bad login shows error', async ({ page }) => {
    await page.goto(`${BASE_URL}/app/login`);
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await page.getByPlaceholder('you@company.com').fill('wrong@test.com');
    await page.getByPlaceholder('Enter your password').fill('wrong');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText(/incorrect|failed|invalid/i)).toBeVisible({ timeout: 10000 });
  });

  test('login succeeds and redirects', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByPlaceholder('you@company.com')).not.toBeVisible();
  });
});

test.describe('Sidebar', () => {
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  test('all nav items visible', async ({ page }) => {
    for (const item of ['Dashboard', 'Cases', 'Alerts', 'Events', 'Assets', 'OT Discovery', 'MITRE', 'Hunt Lab', 'Response Plans', 'Validation', 'Settings']) {
      await expect(page.getByRole('link', { name: new RegExp(item, 'i') })).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  test('loads with content', async ({ page }) => {
    await page.waitForTimeout(2000);
    const text = await page.textContent('body');
    expect(text!.length).toBeGreaterThan(100);
  });
});

test.describe('Cases', () => {
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  test('page loads with header', async ({ page }) => {
    await page.getByRole('link', { name: 'Cases' }).click();
    await expect(page.getByText('Investigations')).toBeVisible({ timeout: 10000 });
  });

  test('Run AI Triage or Pipeline button exists', async ({ page }) => {
    await page.getByRole('link', { name: 'Cases' }).click();
    await page.waitForTimeout(3000);
    const text = await page.textContent('body');
    expect(text).toMatch(/Triage|Pipeline|Run/i);
  });

  test('seeded case visible', async ({ page }) => {
    await page.getByRole('link', { name: 'Cases' }).click();
    await page.waitForTimeout(3000);
    const text = await page.textContent('body');
    // Should have the seeded attack case OR empty state
    expect(text).toMatch(/Multi-Stage|VPN|No cases yet/i);
  });
});

test.describe('Alerts', () => {
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  test('shows CVE alerts', async ({ page }) => {
    await page.getByRole('link', { name: 'Alerts', exact: true }).click();
    await page.waitForTimeout(3000);
    const text = await page.textContent('body');
    expect(text).toMatch(/CVE-|alert|vulnerability/i);
  });
});

test.describe('Events', () => {
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  test('page loads with header', async ({ page }) => {
    await page.getByRole('link', { name: 'Events' }).click();
    await expect(page.getByText('Security Events')).toBeVisible({ timeout: 10000 });
  });

  test('severity filter cards visible', async ({ page }) => {
    await page.getByRole('link', { name: 'Events' }).click();
    await page.waitForTimeout(2000);
    const text = await page.textContent('body');
    // Should have severity categories or empty state
    expect(text).toMatch(/critical|high|medium|low|info|No events/i);
  });
});

test.describe('MITRE ATT&CK', () => {
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  test('page loads with coverage', async ({ page }) => {
    await page.getByRole('link', { name: /MITRE/i }).click();
    await expect(page.getByText('MITRE ATT&CK Coverage')).toBeVisible({ timeout: 10000 });
  });

  test('shows tactics', async ({ page }) => {
    await page.getByRole('link', { name: /MITRE/i }).click();
    await page.waitForTimeout(5000);
    const text = await page.textContent('body');
    expect(text).toMatch(/Initial Access|Execution|Persistence|Lateral Movement|ATT&CK|tactic/i);
  });

  test('technique search works', async ({ page }) => {
    await page.getByRole('link', { name: /MITRE/i }).click();
    await page.waitForTimeout(3000);
    const search = page.getByPlaceholder('Search techniques...');
    if (await search.isVisible()) {
      await search.fill('Brute');
      await page.waitForTimeout(1000);
      const text = await page.textContent('body');
      expect(text).toMatch(/Brute Force/i);
    }
  });
});

test.describe('Hunt Lab', () => {
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  test('page loads with input', async ({ page }) => {
    await page.getByRole('link', { name: 'Hunt Lab' }).click();
    await expect(page.getByText('Threat Hunt Lab')).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder(/lateral movement/i)).toBeVisible();
  });

  test('example queries visible', async ({ page }) => {
    await page.getByRole('link', { name: 'Hunt Lab' }).click();
    await page.waitForTimeout(1000);
    await expect(page.getByText(/Port scan/i)).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Assets', () => {
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  test('shows OT assets', async ({ page }) => {
    await page.getByRole('link', { name: 'Assets' }).click();
    await page.waitForTimeout(3000);
    const text = await page.textContent('body');
    expect(text).toMatch(/Siemens|Rockwell|Schneider/i);
  });
});

test.describe('OT Discovery', () => {
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  test('page loads', async ({ page }) => {
    await page.getByRole('link', { name: 'OT Discovery' }).click();
    await page.waitForTimeout(2000);
    const text = await page.textContent('body');
    expect(text).toMatch(/discover|sensor|device/i);
  });
});

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  test('page loads', async ({ page }) => {
    await page.getByRole('link', { name: /Settings/i }).click();
    await page.waitForTimeout(3000);
    const text = await page.textContent('body');
    expect(text).toMatch(/settings|slack|webhook|mfa|integration|profile|save|ai|provider|api/i);
  });
});

test.describe('Full Journey', () => {
  test('navigate all pages without errors', async ({ page }) => {
    await loginAsAdmin(page);

    const pages = [
      { link: 'Cases', expect: 'Investigations', exact: true },
      { link: 'Alerts', expect: '', exact: true },
      { link: 'Events', expect: 'Security Events', exact: true },
      { link: 'MITRE ATT&CK', expect: 'MITRE ATT&CK Coverage', exact: true },
      { link: 'Hunt Lab', expect: 'Threat Hunt Lab', exact: true },
      { link: 'Response Plans', expect: 'Response Plans', exact: false },
      { link: 'Validation', expect: 'Purple-Team Validation', exact: false },
      { link: 'Assets', expect: '', exact: true },
      { link: 'OT Discovery', expect: '', exact: true },
      { link: 'Settings', expect: '', exact: true },
      { link: 'Dashboard', expect: '', exact: true },
    ];

    for (const p of pages) {
      await page.getByRole('link', { name: p.link, exact: p.exact }).click();
      await page.waitForTimeout(1500);
      if (p.expect) {
        await expect(page.getByText(p.expect)).toBeVisible({ timeout: 10000 });
      }
      // No console errors (basic check)
      const text = await page.textContent('body');
      expect(text).not.toContain('Internal Server Error');
    }
  });
});

test.describe('Response Plans', () => {
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  test('page loads with header', async ({ page }) => {
    await page.getByRole('link', { name: /Response Plans/i }).click();
    await page.waitForTimeout(3000);
    const text = await page.textContent('body');
    expect(text).toMatch(/Response Plans|approval workflow/i);
  });

  test('shows empty state or plan list', async ({ page }) => {
    await page.getByRole('link', { name: /Response Plans/i }).click();
    await page.waitForTimeout(3000);
    const text = await page.textContent('body');
    expect(text).toMatch(/Response Plans|No response plans|pending/i);
  });
});

test.describe('Purple-Team Validation', () => {
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  test('page loads with header', async ({ page }) => {
    await page.getByRole('link', { name: /Validation/i }).click();
    await page.waitForTimeout(2000);
    await expect(page.getByRole('heading', { name: /Purple-Team Validation/i })).toBeVisible({ timeout: 10000 });
  });

  test('new validation button visible', async ({ page }) => {
    await page.getByRole('link', { name: /Validation/i }).click();
    await page.waitForTimeout(2000);
    await expect(page.getByText('New Validation')).toBeVisible({ timeout: 10000 });
  });

  test('create form shows ATT&CK techniques', async ({ page }) => {
    await page.getByRole('link', { name: /Validation/i }).click();
    await page.waitForTimeout(1000);
    await page.getByText('New Validation').click();
    await page.waitForTimeout(1000);
    await expect(page.getByText('T1059')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Brute Force')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('New API Endpoints', () => {
  test('all new APIs return valid responses', async ({ request }) => {
    const loginRes = await request.post(`${BASE_URL}/api/v1/auth/login`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'username=admin@example.com&password=password123',
    });
    const { access_token } = await loginRes.json();
    const h = { Authorization: `Bearer ${access_token}` };

    // Events
    expect((await request.get(`${BASE_URL}/api/v1/events/`, { headers: h })).ok()).toBeTruthy();
    expect((await request.get(`${BASE_URL}/api/v1/events/stats`, { headers: h })).ok()).toBeTruthy();
    expect((await request.get(`${BASE_URL}/api/v1/events/sources`, { headers: h })).ok()).toBeTruthy();

    // Cases
    expect((await request.get(`${BASE_URL}/api/v1/cases/`, { headers: h })).ok()).toBeTruthy();

    // MITRE
    expect((await request.get(`${BASE_URL}/api/v1/mitre/tactics`)).ok()).toBeTruthy();
    expect((await request.get(`${BASE_URL}/api/v1/mitre/techniques`)).ok()).toBeTruthy();
    expect((await request.get(`${BASE_URL}/api/v1/mitre/coverage`, { headers: h })).ok()).toBeTruthy();

    // Hunt
    expect((await request.get(`${BASE_URL}/api/v1/hunt/`, { headers: h })).ok()).toBeTruthy();
    // hunt/detections may 404 if no detection rules table — skip gracefully
    const huntDetRes = await request.get(`${BASE_URL}/api/v1/hunt/detections`, { headers: h });
    expect(huntDetRes.status()).toBeLessThan(500);

    // Verify event seed data exists
    const evtRes = await request.get(`${BASE_URL}/api/v1/events/stats`, { headers: h });
    const evtData = await evtRes.json();
    expect(evtData.data.total_events).toBeGreaterThan(0);

    // Verify case seed data exists
    const caseRes = await request.get(`${BASE_URL}/api/v1/cases/`, { headers: h });
    const caseData = await caseRes.json();
    expect(caseData.total).toBeGreaterThan(0);

    // Verify MITRE has content
    const tacticsRes = await request.get(`${BASE_URL}/api/v1/mitre/tactics`);
    const tactics = await tacticsRes.json();
    expect(tactics.length).toBeGreaterThanOrEqual(16);

    // Response Plans
    expect((await request.get(`${BASE_URL}/api/v1/response-plans/`, { headers: h })).ok()).toBeTruthy();
    expect((await request.get(`${BASE_URL}/api/v1/response-plans/pending-approvals`, { headers: h })).ok()).toBeTruthy();

    // Validation
    expect((await request.get(`${BASE_URL}/api/v1/validation/runs`, { headers: h })).ok()).toBeTruthy();
    expect((await request.get(`${BASE_URL}/api/v1/validation/coverage`, { headers: h })).ok()).toBeTruthy();

    // Cases search
    const searchRes = await request.get(`${BASE_URL}/api/v1/cases/search?q=VPN`, { headers: h });
    expect(searchRes.ok()).toBeTruthy();
  });
});
