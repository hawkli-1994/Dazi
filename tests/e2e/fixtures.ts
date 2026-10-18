import { expect, test as base, type Page, type TestInfo } from '@playwright/test';

export const routes = {
  home: '/#/',
  newWork: '/#/new',
  capabilities: '/#/capabilities',
  settings: '/#/settings',
} as const;

export const test = base.extend<{ uiGuard: void }>({
  uiGuard: [
    async ({ page, baseURL }, use) => {
      const errors: string[] = [];
      const externalRequests: string[] = [];
      const allowedOrigin = new URL(baseURL ?? 'http://127.0.0.1:4173').origin;
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route(/^https?:\/\//, async (route) => {
        if (new URL(route.request().url()).origin !== allowedOrigin) {
          externalRequests.push(route.request().url());
          await route.abort('blockedbyclient');
          return;
        }
        await route.continue();
      });
      // Fix the greeting and fixture timestamps without freezing loading timers.
      await page.clock.setFixedTime(new Date('2026-10-18T01:00:00.000Z'));
      await use();
      expect(errors, 'The UI must not throw uncaught browser errors.').toEqual([]);
      expect(externalRequests, 'The UI-only preview must not contact outside services.').toEqual(
        [],
      );
    },
    { auto: true },
  ],
});

export { expect };

export async function loadDemo(page: Page) {
  await page.goto(routes.settings);
  await page.getByTestId('load-demo').click();
  await expect(page).toHaveURL(/\/#\/$/);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('main')).toContainText('品牌官网焕新');
}

export async function createWork(
  page: Page,
  { goal = '检查登录流程，整理需要确认的改动。', directory = '/demo/release-check' } = {},
) {
  await page.goto(routes.newWork);
  await page.getByTestId('new-work-goal').fill(goal);
  await page.getByTestId('new-work-directory').fill(directory);
  await page.getByTestId('create-work').click();
  await expect(page).toHaveURL(/#\/work\//);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return { url: page.url(), title: await page.getByRole('heading', { level: 1 }).innerText() };
}

export async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document, 'The page must fit the viewport width.').toBeLessThanOrEqual(
    dimensions.viewport + 1,
  );
  expect(dimensions.body, 'The body must not introduce horizontal scrolling.').toBeLessThanOrEqual(
    dimensions.viewport + 1,
  );
}

export async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expectNoHorizontalOverflow(page);
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: 'disabled', caret: 'hide' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
  const extendsViewport = await page.evaluate(
    () => document.documentElement.scrollHeight > innerHeight + 1,
  );
  if (extendsViewport) {
    const fullPath = testInfo.outputPath(`${name}-full.png`);
    await page.screenshot({
      path: fullPath,
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
    });
    await testInfo.attach(`${name}-full`, { path: fullPath, contentType: 'image/png' });
  }
}
