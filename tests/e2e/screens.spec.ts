import { capture, expect, loadDemo, routes, test } from './fixtures';

test('first launch shows a quiet empty briefing', async ({ page }, testInfo) => {
  await page.goto(routes.home);
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('app-shell')).toHaveClass(/is-welcome/);
  await expect(page.getByTestId('work-composer')).toBeEmpty();
  await expect(page.getByTestId('decision')).toHaveCount(0);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await capture(page, testInfo, '01-empty-briefing');
});

test('new work is a complete page with labelled inputs', async ({ page }, testInfo) => {
  await page.goto(routes.newWork);
  await expect(page.getByTestId('new-work-goal')).toBeVisible();
  await expect(page.getByTestId('new-work-goal')).toHaveAccessibleName(/.+/);
  await expect(page.getByTestId('new-work-directory')).toHaveAccessibleName(/.+/);
  await expect(page.getByTestId('create-work')).toHaveAccessibleName(/.+/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await capture(page, testInfo, '02-new-work');
});

test('demo briefing presents pending decisions and progress', async ({ page }, testInfo) => {
  await loadDemo(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('main')).toContainText('等你决定');
  await expect(page.getByRole('main')).toContainText('已经推进');
  await capture(page, testInfo, '03-loaded-briefing');
});

for (const screen of [
  { route: routes.capabilities, name: 'capabilities', screenshot: '04-capabilities' },
  { route: routes.settings, name: 'settings', screenshot: '05-settings' },
]) {
  test(`${screen.name} is a full page, not a modal`, async ({ page }, testInfo) => {
    await page.goto(screen.route);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await capture(page, testInfo, screen.screenshot);
  });
}
