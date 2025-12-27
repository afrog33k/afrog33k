import { test, expect } from '@playwright/test';

test.describe('Feedback Buttons', () => {
  test.beforeEach(async ({ page }) => {
    // Mock reports endpoint
    await page.route('**/api/reports/home', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          top3: [
            {
              id: 'report-1',
              type: 'decision_memo',
              title: 'Test Report',
              summary: 'Test summary',
              impact_score: 0.8,
              novelty_score: 0.7,
              relevance_score: 0.6,
              blended_score: 0.73,
              pinned: 0,
              promoted: 1,
              archived: 0,
              findings_json: '[]',
              evidence_json: '[]',
              ui_blocks_json: '[]',
              created_at: new Date().toISOString(),
            },
          ],
          relevancePick: null,
        }),
      });
    });

    // Mock UI actions endpoint
    await page.route('**/api/ui-actions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          actions: [
            { action: 'useful', enabled: 1, shown_count: 10, clicked_count: 5, success_rate: 0.5 },
            { action: 'not_useful', enabled: 1, shown_count: 10, clicked_count: 2, success_rate: 0.2 },
            { action: 'more_depth', enabled: 1, shown_count: 8, clicked_count: 3, success_rate: 0.375 },
            { action: 'kill_thread', enabled: 1, shown_count: 10, clicked_count: 1, success_rate: 0.1 },
            { action: 'revisit_later', enabled: 1, shown_count: 5, clicked_count: 2, success_rate: 0.4 },
          ],
        }),
      });
    });

    // Mock action shown endpoint
    await page.route('**/api/ui-actions/*/shown', async (route) => {
      await route.fulfill({ status: 200, body: JSON.stringify({ success: true }) });
    });
  });

  test('should display feedback buttons', async ({ page }) => {
    await page.goto('/');

    // Wait for the report card to appear first
    await page.waitForSelector('text=Test Report', { timeout: 10000 });

    // The feedback buttons should appear below the report card
    await expect(page.locator('button:has-text("Useful")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button:has-text("Not useful")')).toBeVisible();
    await expect(page.locator('button:has-text("Go deeper")')).toBeVisible();
  });

  test('should send feedback when button clicked', async ({ page }) => {
    let feedbackSent = false;
    let sentAction = '';

    await page.route('**/api/feedback', async (route) => {
      feedbackSent = true;
      const body = route.request().postDataJSON();
      sentAction = body.action;
      await route.fulfill({ status: 200, body: JSON.stringify({ id: 'f1' }) });
    });

    await page.goto('/');

    await page.waitForSelector('button:has-text("Useful")');
    await page.click('button:has-text("Useful")');

    await page.waitForTimeout(500);

    expect(feedbackSent).toBe(true);
    expect(sentAction).toBe('useful');
  });

  test('should display button icons', async ({ page }) => {
    await page.goto('/');

    // Wait for the report card to appear first
    await page.waitForSelector('text=Test Report', { timeout: 10000 });

    // Wait for feedback buttons
    await expect(page.locator('button:has-text("Useful")')).toBeVisible({ timeout: 10000 });

    // Check that button text includes the icon character
    const usefulBtnText = await page.locator('button:has-text("Useful")').textContent();
    expect(usefulBtnText).toContain('+');

    const notUsefulBtnText = await page.locator('button:has-text("Not useful")').textContent();
    expect(notUsefulBtnText).toContain('-');
  });

  test('should only show enabled actions', async ({ page }) => {
    await page.route('**/api/ui-actions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          actions: [
            { action: 'useful', enabled: 1, shown_count: 10, clicked_count: 5, success_rate: 0.5 },
            { action: 'not_useful', enabled: 0, shown_count: 10, clicked_count: 2, success_rate: 0.2 },
          ],
        }),
      });
    });

    await page.goto('/');

    await page.waitForSelector('button:has-text("Useful")');

    await expect(page.locator('button:has-text("Useful")')).toBeVisible();
    await expect(page.locator('button:has-text("Not useful")')).not.toBeVisible();
  });
});

test.describe('Telemetry', () => {
  test('should track report views', async ({ page }) => {
    const telemetryEvents: any[] = [];

    await page.route('**/api/telemetry', async (route) => {
      telemetryEvents.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, body: JSON.stringify({ id: 't1' }) });
    });

    await page.route('**/api/reports/home', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          top3: [
            {
              id: 'report-1',
              type: 'decision_memo',
              title: 'Test Report',
              summary: 'Test',
              impact_score: 0.5,
              novelty_score: 0.5,
              relevance_score: 0.5,
              blended_score: 0.5,
              pinned: 0,
              promoted: 1,
              archived: 0,
              findings_json: '[]',
              evidence_json: '[]',
              ui_blocks_json: '[]',
              created_at: new Date().toISOString(),
            },
          ],
          relevancePick: null,
        }),
      });
    });

    await page.route('**/api/ui-actions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ actions: [] }),
      });
    });

    await page.goto('/');

    // Wait for the report to be visible (triggers IntersectionObserver)
    await page.waitForSelector('text=Test Report');

    // Scroll the card into view to ensure IntersectionObserver triggers
    await page.locator('text=Test Report').scrollIntoViewIfNeeded();

    // Wait for telemetry flush interval (5 seconds) plus buffer
    await page.waitForTimeout(6000);

    // Should have tracked an 'open' event
    const openEvents = telemetryEvents.filter((e) => e.event_type === 'open');
    expect(openEvents.length).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Pin Functionality', () => {
  test('should pin a report', async ({ page }) => {
    let pinCalled = false;

    await page.route('**/api/reports/*/pin', async (route) => {
      pinCalled = true;
      await route.fulfill({ status: 200, body: JSON.stringify({ success: true }) });
    });

    await page.route('**/api/reports/home', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          top3: [
            {
              id: 'report-1',
              type: 'decision_memo',
              title: 'Test Report',
              summary: 'Test',
              impact_score: 0.5,
              novelty_score: 0.5,
              relevance_score: 0.5,
              blended_score: 0.5,
              pinned: 0,
              promoted: 1,
              archived: 0,
              findings_json: '[]',
              evidence_json: '[]',
              ui_blocks_json: '[]',
              created_at: new Date().toISOString(),
            },
          ],
          relevancePick: null,
        }),
      });
    });

    await page.route('**/api/ui-actions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ actions: [] }),
      });
    });

    await page.goto('/');

    await page.waitForSelector('text=Test Report');

    // Hover to reveal pin button
    const card = page.locator('.group').first();
    await card.hover();

    // Click pin button
    await card.locator('button[title="Pin"]').click();

    await page.waitForTimeout(500);

    expect(pinCalled).toBe(true);
  });
});
