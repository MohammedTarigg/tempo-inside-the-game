// Every page opens without an error and shows what it is for. Each test keeps a screenshot of what it saw.
import { expect, test, type Page } from '@playwright/test';

// collects anything the page says went wrong
const watch = (page: Page) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
  return problems;
};
const shoot = (page: Page, name: string) => page.screenshot({ path: `web/e2e/results/${name}.png` });

test('home: four ways in, each to a page that exists, each opening its window when pointed at', async ({
  page,
  request,
}) => {
  const problems = watch(page);
  await page.goto('/');
  const ways = page.locator('.names a');
  await expect(ways).toHaveCount(4);
  for (const href of await ways.evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href')))) {
    expect((await request.get(href!)).ok()).toBe(true);
  }
  await page.waitForTimeout(1300);
  await ways.nth(2).hover();
  await expect(ways.nth(2)).toHaveClass(/here/);
  await expect(page.locator('.pane.on video')).toHaveAttribute('src', '/previews/desk.mp4');
  await page.waitForTimeout(800);
  await shoot(page, 'home');
  expect(problems).toEqual([]);
});

test('match: the demo match loads and opens where it is asked', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/match/?m=72');
  await page.waitForFunction(() => window.__tempo !== undefined);
  await expect(page.locator('#clock')).toHaveText(/^7[12]:/);
  await expect(page.locator('#hg')).toHaveText('1');
  await shoot(page, 'match');
  expect(problems).toEqual([]);
});

test('match: at full time the strip rises and a pin plays its moment again', async ({ page }) => {
  await page.goto('/match/?m=96');
  await expect(page.locator('#screen')).toHaveClass(/ft/);
  const pins = page.locator('#track .tp');
  await expect(pins).toHaveCount(3);
  await pins.nth(1).click();
  await expect(pins.nth(1)).toHaveClass(/on/);
  await expect(page.locator('#clock')).toHaveText(/^71:/);
  await shoot(page, 'recap');
});

test('desk: rows of what was considered, held items with their reason', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/desk/?m=82');
  await expect(page.locator('#drows li').first()).toBeVisible();
  await expect(page.locator('#drows li.held small').first()).toHaveText(/ago|reached/);
  await expect(page.locator('#modes')).toBeHidden();
  await shoot(page, 'desk');
  expect(problems).toEqual([]);
});

test('replay: the earlier attempt and the goal', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/replay/?t=8.2');
  await page.waitForFunction(() => (window.__replay?.TOTAL ?? 0) > 0);
  await expect(page.locator('#l1')).not.toBeEmpty();
  await shoot(page, 'replay');
  expect(problems).toEqual([]);
});

test('film: plays from the middle, silent', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/film/?at=40&mute=1');
  await page.waitForFunction(() => (window.__tour?.TOTAL ?? 0) > 90, null, { timeout: 30_000 });
  await expect(page.locator('.tcap h2')).not.toBeEmpty();
  await shoot(page, 'film');
  expect(problems).toEqual([]);
});

test('evidence: every claim has its figure and its command', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/evidence/');
  const rows = page.locator('.claims > li');
  await expect(rows).toHaveCount(8);
  for (const row of await rows.all()) {
    await expect(row.locator('.figure')).toHaveText(/\d/);
    await expect(row.locator('code')).toHaveText(/^uv run tempo /);
  }
  await shoot(page, 'evidence');
  expect(problems).toEqual([]);
});
