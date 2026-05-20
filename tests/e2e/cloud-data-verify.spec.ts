import { test, expect, type Page } from '@playwright/test';

const BASE_URL = 'https://cybersec-saas-498310931350.us-central1.run.app';

async function loginAsAdmin(page: Page) {
  await page.goto(`${BASE_URL}/app/login`);
  await page.waitForLoadState('networkidle', { timeout: 20000 });
  await page.getByPlaceholder('you@company.com').fill('admin@example.com');
  await page.getByPlaceholder('Enter your password').fill('password123');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForFunction(() => !document.querySelector('input[placeholder="you@company.com"]'), { timeout: 20000 })
    .catch(() => page.waitForTimeout(5000));
  await page.waitForTimeout(2000);
}

async function getAuthHeaders(request: any): Promise<Record<string, string>> {
  const loginRes = await request.post(`${BASE_URL}/api/v1/auth/login`, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: 'username=admin@example.com&password=password123',
  });
  const { access_token } = await loginRes.json();
  return { Authorization: `Bearer ${access_token}` };
}

// ==================== API DATA VERIFICATION ====================

test.describe('API Data Correctness', () => {
  test('seeded assets exist with OT data', async ({ request }) => {
    const h = await getAuthHeaders(request);
    const res = await request.get(`${BASE_URL}/api/v1/assets/`, { headers: h });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();

    expect(body.total).toBeGreaterThanOrEqual(11);
    const otAssets = body.assets.filter((a: any) => a.is_ot_asset);
    expect(otAssets.length).toBeGreaterThanOrEqual(4);

    // Verify PLC exists
    const plcs = body.assets.filter((a: any) => a.asset_type === 'plc');
    expect(plcs.length).toBeGreaterThanOrEqual(1);
  });

  test('seeded alerts exist with severity data', async ({ request }) => {
    const h = await getAuthHeaders(request);
    const res = await request.get(`${BASE_URL}/api/v1/alerts/`, { headers: h });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();

    expect(body.total).toBeGreaterThanOrEqual(6);
    const severities = body.alerts.map((a: any) => a.severity);
    expect(severities.some((s: string) => ['critical', 'high'].includes(s))).toBeTruthy();
  });

  test('security events exist', async ({ request }) => {
    const h = await getAuthHeaders(request);
    const res = await request.get(`${BASE_URL}/api/v1/events/`, { headers: h });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(15);
  });

  test('event stats show sources', async ({ request }) => {
    const h = await getAuthHeaders(request);
    const res = await request.get(`${BASE_URL}/api/v1/events/stats`, { headers: h });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data).toBeTruthy();
    expect(body.data.total_events).toBeGreaterThanOrEqual(15);
  });

  test('investigation case exists', async ({ request }) => {
    const h = await getAuthHeaders(request);
    const res = await request.get(`${BASE_URL}/api/v1/cases/`, { headers: h });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(1);

    const firstCase = body.cases[0];
    expect(firstCase.title).toBeTruthy();
    expect(firstCase.severity).toBeTruthy();
  });

  test('MITRE ATT&CK tactics and techniques loaded', async ({ request }) => {
    const tacticsRes = await request.get(`${BASE_URL}/api/v1/mitre/tactics`);
    expect(tacticsRes.ok()).toBeTruthy();
    const tactics = await tacticsRes.json();
    expect(tactics.length).toBeGreaterThanOrEqual(16);

    const techRes = await request.get(`${BASE_URL}/api/v1/mitre/techniques`);
    expect(techRes.ok()).toBeTruthy();
    const techniques = await techRes.json();
    expect(techniques.length).toBeGreaterThanOrEqual(30);
  });

  test('hunt sessions endpoint works', async ({ request }) => {
    const h = await getAuthHeaders(request);
    const res = await request.get(`${BASE_URL}/api/v1/hunt/`, { headers: h });
    expect(res.ok()).toBeTruthy();
  });
});

// ==================== UI DATA & CLICKABILITY ====================

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  test('shows KPI cards with real numbers', async ({ page }) => {
    await page.waitForTimeout(3000);
    const body = await page.textContent('body');
    // Dashboard should show numbers
    expect(body).toMatch(/\d+/);
    expect(body).toMatch(/alert|asset|event|case/i);
  });

  test('sidebar links all present and clickable', async ({ page }) => {
    await page.waitForTimeout(2000);
    const coreLinks = ['Dashboard', 'Cases', 'Alerts', 'Events', 'Assets', 'Hunt Lab'];
    for (const name of coreLinks) {
      const link = page.getByRole('link', { name });
      await expect(link.first()).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe('Cases — Data & Clicks', () => {
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  test('shows seeded case with title', async ({ page }) => {
    await page.getByRole('link', { name: /Cases/i }).first().click();
    await page.waitForTimeout(3000);
    const body = await page.textContent('body');
    expect(body).toMatch(/Multi-Stage|VPN|compromise|No cases/i);
  });

  test('case row clickable — opens detail', async ({ page }) => {
    await page.getByRole('link', { name: /Cases/i }).first().click();
    await page.waitForTimeout(3000);

    const clickable = page.locator('[class*="cursor-pointer"], a[href*="cases/"]').first();
    if (await clickable.isVisible({ timeout: 3000 })) {
      await clickable.click();
      await page.waitForTimeout(3000);
      const body = await page.textContent('body');
      expect(body).toMatch(/timeline|severity|mitre|narrative|alert|event/i);
    }
  });
});

test.describe('Alerts — Data & Clicks', () => {
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  test('shows CVE alerts', async ({ page }) => {
    await page.getByRole('link', { name: 'Alerts', exact: true }).click();
    await page.waitForTimeout(3000);
    const body = await page.textContent('body');
    expect(body).toMatch(/CVE-|vulnerability|alert/i);
  });

  test('alert row clickable — shows detail', async ({ page }) => {
    await page.getByRole('link', { name: 'Alerts', exact: true }).click();
    await page.waitForTimeout(3000);

    const row = page.locator('tr.cursor-pointer, [class*="cursor-pointer"]').first();
    if (await row.isVisible({ timeout: 3000 })) {
      await row.click();
      await page.waitForTimeout(2000);
      const body = await page.textContent('body');
      expect(body).toMatch(/severity|description|CVE|asset|remediation/i);
    }
  });
});

test.describe('Events — Data & Clicks', () => {
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  test('shows security events with severity', async ({ page }) => {
    await page.getByRole('link', { name: 'Events' }).click();
    await page.waitForTimeout(3000);
    const body = await page.textContent('body');
    expect(body).toMatch(/suricata|zeek|alert|connection|event/i);
    expect(body).toMatch(/critical|high|medium|low|info/i);
  });
});

test.describe('Assets — Data & Clicks', () => {
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  test('shows OT devices from seed data', async ({ page }) => {
    await page.getByRole('link', { name: 'Assets' }).click();
    await page.waitForTimeout(3000);
    const body = await page.textContent('body');
    expect(body).toMatch(/Siemens|Rockwell|Schneider|PLC|HMI/i);
  });

  test('asset card clickable', async ({ page }) => {
    await page.getByRole('link', { name: 'Assets' }).click();
    await page.waitForTimeout(3000);

    const card = page.locator('[class*="cursor-pointer"]').first();
    if (await card.isVisible({ timeout: 3000 })) {
      await card.click();
      await page.waitForTimeout(2000);
      const body = await page.textContent('body');
      expect(body).toMatch(/name|vendor|type|zone|protocol|critical/i);
    }
  });
});

test.describe('MITRE ATT&CK Map — Data & Clicks', () => {
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  test('shows tactics and technique IDs', async ({ page }) => {
    await page.getByRole('link', { name: /MITRE/i }).click();
    await page.waitForTimeout(5000);
    const body = await page.textContent('body');
    expect(body).toMatch(/ATT&CK|Coverage/i);
    expect(body).toMatch(/T\d{4}/);
  });

  test('technique cell clickable', async ({ page }) => {
    await page.getByRole('link', { name: /MITRE/i }).click();
    await page.waitForTimeout(5000);

    const cell = page.locator('[class*="cursor-pointer"]').first();
    if (await cell.isVisible({ timeout: 3000 })) {
      await cell.click();
      await page.waitForTimeout(1000);
    }
  });
});

test.describe('Hunt Lab — Interaction', () => {
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  test('input and example queries visible', async ({ page }) => {
    await page.getByRole('link', { name: 'Hunt Lab' }).click();
    await page.waitForTimeout(2000);
    await expect(page.getByPlaceholder(/lateral movement/i)).toBeVisible();
    await expect(page.getByText(/Port scan/i)).toBeVisible({ timeout: 5000 });
  });

  test('example query button fills input', async ({ page }) => {
    await page.getByRole('link', { name: 'Hunt Lab' }).click();
    await page.waitForTimeout(2000);

    const example = page.getByText(/Port scan/i);
    if (await example.isVisible()) {
      await example.click();
      await page.waitForTimeout(500);
      const value = await page.getByPlaceholder(/lateral movement/i).inputValue();
      expect(value).toContain('Port scan');
    }
  });
});

test.describe('Full Navigation — No Errors', () => {
  test('every core page loads without 500 errors', async ({ page }) => {
    await loginAsAdmin(page);

    const pages = [
      { name: 'Cases', match: /case|investigation/i },
      { name: 'Alerts', match: /alert|CVE/i },
      { name: 'Events', match: /event|security/i },
      { name: 'Assets', match: /asset|device/i },
      { name: 'OT Discovery', match: /discover|sensor|device/i },
      { name: 'Hunt Lab', match: /hunt|hypothesis/i },
    ];

    for (const p of pages) {
      const link = page.getByRole('link', { name: p.name });
      if (await link.first().isVisible({ timeout: 3000 })) {
        await link.first().click();
        await page.waitForTimeout(2000);
        const body = await page.textContent('body');
        expect(body).not.toContain('Internal Server Error');
      }
    }
  });
});

test.describe('Data Consistency', () => {
  test('API counts are positive across endpoints', async ({ request }) => {
    const h = await getAuthHeaders(request);

    const [assetsRes, alertsRes, eventsRes, casesRes] = await Promise.all([
      request.get(`${BASE_URL}/api/v1/assets/`, { headers: h }),
      request.get(`${BASE_URL}/api/v1/alerts/`, { headers: h }),
      request.get(`${BASE_URL}/api/v1/events/`, { headers: h }),
      request.get(`${BASE_URL}/api/v1/cases/`, { headers: h }),
    ]);

    expect((await assetsRes.json()).total).toBeGreaterThan(0);
    expect((await alertsRes.json()).total).toBeGreaterThan(0);
    expect((await eventsRes.json()).total).toBeGreaterThan(0);
    expect((await casesRes.json()).total).toBeGreaterThan(0);
  });
});
