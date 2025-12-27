import { test, expect } from '@playwright/test';

test.describe('All Cards Page', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the reports endpoint
    await page.route('**/api/reports?*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reports: [
            {
              id: 'r1',
              type: 'decision_memo',
              title: 'Decision Report',
              summary: 'A decision',
              impact_score: 0.9,
              novelty_score: 0.8,
              relevance_score: 0.7,
              blended_score: 0.83,
              pinned: 1,
              promoted: 1,
              archived: 0,
              findings_json: '[]',
              evidence_json: '[]',
              ui_blocks_json: '[]',
              created_at: new Date().toISOString(),
            },
            {
              id: 'r2',
              type: 'research_brief',
              title: 'Research Report',
              summary: 'Some research',
              impact_score: 0.6,
              novelty_score: 0.7,
              relevance_score: 0.5,
              blended_score: 0.63,
              pinned: 0,
              promoted: 1,
              archived: 0,
              findings_json: '[]',
              evidence_json: '[]',
              ui_blocks_json: '[]',
              created_at: new Date().toISOString(),
            },
          ],
          total: 2,
        }),
      });
    });
  });

  test('should display page header', async ({ page }) => {
    await page.goto('/all');

    await expect(page.locator('h1')).toContainText('All Cards');
    await expect(page.locator('text=2 reports total')).toBeVisible();
  });

  test('should have back navigation', async ({ page }) => {
    await page.goto('/all');

    const backLink = page.locator('a[href="/"]');
    await expect(backLink).toBeVisible();
  });

  test('should display all reports', async ({ page }) => {
    await page.goto('/all');

    await expect(page.locator('text=Decision Report')).toBeVisible();
    await expect(page.locator('text=Research Report')).toBeVisible();
  });

  test('should have sort options', async ({ page }) => {
    await page.goto('/all');

    const sortButtons = page.locator('text=Sort:').locator('..').locator('button');

    // Should have sort buttons
    await expect(page.locator('button:has-text("Blended")')).toBeVisible();
    await expect(page.locator('button:has-text("Newest")')).toBeVisible();
    await expect(page.locator('button:has-text("Impact")')).toBeVisible();
    await expect(page.locator('button:has-text("Novelty")')).toBeVisible();
  });

  test('should have type filter', async ({ page }) => {
    await page.goto('/all');

    const typeSelect = page.locator('select');
    await expect(typeSelect).toBeVisible();

    // Check options
    await expect(typeSelect.locator('option[value=""]')).toContainText('All types');
    await expect(typeSelect.locator('option[value="decision_memo"]')).toContainText('Decision');
  });

  test('should have pinned filter', async ({ page }) => {
    await page.goto('/all');

    // Check for pinned filter buttons using exact text match
    await expect(page.getByRole('button', { name: 'Pinned', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unpinned' })).toBeVisible();
  });

  test('should filter by type', async ({ page }) => {
    let requestedType = '';

    await page.route('**/api/reports?*', async (route) => {
      const url = new URL(route.request().url());
      requestedType = url.searchParams.get('type') || '';

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ reports: [], total: 0 }),
      });
    });

    await page.goto('/all');

    // Select decision type
    await page.selectOption('select', 'decision_memo');

    // Wait for request
    await page.waitForTimeout(500);

    expect(requestedType).toBe('decision_memo');
  });

  test('should change sort order', async ({ page }) => {
    let requestedSort = '';

    await page.route('**/api/reports?*', async (route) => {
      const url = new URL(route.request().url());
      requestedSort = url.searchParams.get('sort') || '';

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ reports: [], total: 0 }),
      });
    });

    await page.goto('/all');

    // Click Impact sort
    await page.click('button:has-text("Impact")');

    await page.waitForTimeout(500);

    expect(requestedSort).toBe('impact');
  });

  test('should show empty state when no results', async ({ page }) => {
    await page.route('**/api/reports?*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ reports: [], total: 0 }),
      });
    });

    await page.goto('/all');

    await expect(page.locator('text=No reports match your filters')).toBeVisible();
  });

  test('should highlight pinned reports', async ({ page }) => {
    await page.goto('/all');

    // The pinned report should show "pinned" indicator near the title
    await expect(page.locator('text=Decision Report')).toBeVisible();
    await expect(page.locator('span:has-text("pinned")')).toBeVisible();
  });
});

test.describe('Filtering and Sorting', () => {
  test('should apply multiple filters', async ({ page }) => {
    let lastParams: Record<string, string> = {};

    await page.route('**/api/reports?*', async (route) => {
      const url = new URL(route.request().url());
      lastParams = Object.fromEntries(url.searchParams);

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ reports: [], total: 0 }),
      });
    });

    await page.goto('/all');

    // Apply type filter
    await page.selectOption('select', 'research_brief');

    // Apply pinned filter
    await page.click('button:has-text("Pinned")');

    // Apply sort
    await page.click('button:has-text("Novelty")');

    await page.waitForTimeout(500);

    expect(lastParams.type).toBe('research_brief');
    expect(lastParams.pinned).toBe('1');
    expect(lastParams.sort).toBe('novelty');
  });

  test('should highlight active sort button', async ({ page }) => {
    await page.route('**/api/reports?*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ reports: [], total: 0 }),
      });
    });

    await page.goto('/all');

    // Blended should be active by default
    const blendedBtn = page.locator('button:has-text("Blended")');
    await expect(blendedBtn).toHaveClass(/bg-accent/);

    // Click Impact
    await page.click('button:has-text("Impact")');

    // Impact should now be active
    const impactBtn = page.locator('button:has-text("Impact")');
    await expect(impactBtn).toHaveClass(/bg-accent/);
  });
});
