import { test, expect } from '@playwright/test';

test.describe('Home Page', () => {
  test('should display the header', async ({ page }) => {
    await page.goto('/');

    // Check header elements
    await expect(page.locator('h1')).toContainText('Ronald-GI');
    await expect(page.locator('text=Your research colleague')).toBeVisible();
  });

  test('should have navigation to All Cards', async ({ page }) => {
    await page.goto('/');

    const allCardsLink = page.locator('a[href="/all"]');
    await expect(allCardsLink).toBeVisible();
    await expect(allCardsLink).toContainText('All Cards');
  });

  test('should show empty state when no reports', async ({ page }) => {
    // Mock empty reports response
    await page.route('**/api/reports/home', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ top3: [], relevancePick: null }),
      });
    });

    // Mock empty ui-actions
    await page.route('**/api/ui-actions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ actions: [] }),
      });
    });

    await page.goto('/');

    // When no reports, should show empty state
    await expect(page.locator('text=No reports yet')).toBeVisible();
  });

  test('should show loading state initially', async ({ page }) => {
    // Intercept API to delay response
    await page.route('**/api/reports/home', async (route) => {
      await new Promise((r) => setTimeout(r, 500));
      await route.fulfill({
        status: 200,
        body: JSON.stringify({ top3: [], relevancePick: null }),
      });
    });

    await page.goto('/');
    await expect(page.locator('text=Loading...')).toBeVisible();
  });

  test('should display report cards when available', async ({ page }) => {
    // Mock API response with reports
    await page.route('**/api/reports/home', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          top3: [
            {
              id: 'report-1',
              type: 'decision_memo',
              title: 'Test Decision Report',
              summary: 'This is a test summary',
              decision: 'Do this thing',
              impact_score: 0.8,
              novelty_score: 0.7,
              relevance_score: 0.6,
              blended_score: 0.73,
              pinned: 0,
              promoted: 1,
              archived: 0,
              findings_json: '["Finding 1", "Finding 2"]',
              evidence_json: '[{"url": "https://example.com", "title": "Example"}]',
              ui_blocks_json: '[]',
              created_at: new Date().toISOString(),
            },
          ],
          relevancePick: null,
        }),
      });
    });

    await page.goto('/');

    // Should display the report card
    await expect(page.locator('text=Test Decision Report')).toBeVisible();
    await expect(page.locator('text=This is a test summary')).toBeVisible();
    await expect(page.locator('text=Do this thing')).toBeVisible();
    await expect(page.locator('span:has-text("Decision")')).toBeVisible(); // Type badge
  });

  test('should show relevance pick with indicator', async ({ page }) => {
    await page.route('**/api/reports/home', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          top3: [],
          relevancePick: {
            id: 'relevance-1',
            type: 'research_brief',
            title: 'Relevance Pick Report',
            summary: 'Based on your focus',
            impact_score: 0.5,
            novelty_score: 0.5,
            relevance_score: 0.9,
            blended_score: 0.54,
            pinned: 0,
            promoted: 1,
            archived: 0,
            findings_json: '[]',
            evidence_json: '[]',
            ui_blocks_json: '[]',
            created_at: new Date().toISOString(),
          },
        }),
      });
    });

    await page.goto('/');

    await expect(page.locator('text=Relevance Pick Report')).toBeVisible();
    await expect(page.locator('text=+1 relevance')).toBeVisible();
    await expect(page.locator('text=based on your current focus')).toBeVisible();
  });
});

test.describe('Report Cards', () => {
  test('should display correct type badges', async ({ page }) => {
    const reportTypes = [
      { type: 'decision_memo', label: 'Decision' },
      { type: 'research_brief', label: 'Research' },
      { type: 'repo_signal', label: 'Repo' },
    ];

    for (const rt of reportTypes) {
      await page.route('**/api/reports/home', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            top3: [
              {
                id: 'r1',
                type: rt.type,
                title: `${rt.label} Report`,
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

      await page.goto('/');
      await expect(page.locator(`text=${rt.label}`).first()).toBeVisible();
    }
  });

  test('should show pin button on hover', async ({ page }) => {
    await page.route('**/api/reports/home', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          top3: [
            {
              id: 'r1',
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

    await page.goto('/');

    const card = page.locator('.group').first();
    await card.hover();

    // Pin button should become visible
    const pinButton = card.locator('button[title="Pin"]');
    await expect(pinButton).toBeVisible();
  });

  test('should display evidence links', async ({ page }) => {
    await page.route('**/api/reports/home', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          top3: [
            {
              id: 'r1',
              type: 'research_brief',
              title: 'Report with Evidence',
              summary: 'Has links',
              impact_score: 0.5,
              novelty_score: 0.5,
              relevance_score: 0.5,
              blended_score: 0.5,
              pinned: 0,
              promoted: 1,
              archived: 0,
              findings_json: '[]',
              evidence_json: JSON.stringify([
                { url: 'https://example.com', title: 'Example Source' },
                { url: 'https://test.com', title: 'Test Source' },
              ]),
              ui_blocks_json: '[]',
              created_at: new Date().toISOString(),
            },
          ],
          relevancePick: null,
        }),
      });
    });

    await page.goto('/');

    await expect(page.locator('text=Example Source')).toBeVisible();
    await expect(page.locator('text=Test Source')).toBeVisible();
  });

  test('should display scores', async ({ page }) => {
    await page.route('**/api/reports/home', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          top3: [
            {
              id: 'r1',
              type: 'decision_memo',
              title: 'Report with Scores',
              summary: 'Test',
              impact_score: 0.85,
              novelty_score: 0.72,
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

    await page.goto('/');

    await expect(page.locator('text=Impact: 85%')).toBeVisible();
    await expect(page.locator('text=Novelty: 72%')).toBeVisible();
  });
});
