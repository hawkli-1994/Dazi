import { capture, createWork, expect, loadDemo, routes, test } from './fixtures';

test('system theme changes preserve the active draft and keyboard focus', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await createWork(page);
  const composer = page.getByTestId('work-composer');
  const draft = '这条想法还没有发送。';
  await composer.fill(draft);
  await composer.press('ArrowLeft');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await capture(page, testInfo, '24-light-draft');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(composer).toHaveValue(draft);
  await expect(composer).toBeFocused();
  await capture(page, testInfo, '25-dark-draft');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(composer).toHaveValue(draft);
});

test('explicit theme and language selections update the whole UI', async ({ page }, testInfo) => {
  await page.goto(routes.settings);
  const theme = page.getByTestId('theme-select');
  await theme.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await theme.selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await theme.selectOption('system');
  await page.getByTestId('locale-select').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
  await expect(
    page.getByRole('navigation').getByRole('link', { name: 'Capabilities', exact: true }),
  ).toBeVisible();
  await capture(page, testInfo, '26-english-settings');
  await page.goto(routes.newWork);
  await expect(page.getByTestId('new-work-goal')).toHaveAccessibleName(
    'What would you like to accomplish?',
  );
  await capture(page, testInfo, '27-english-new-work');
  await page.goto(routes.settings);
  await page.getByTestId('locale-select').selectOption('zh');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('设置');
});

test('clearing demo work requires a choice and cancel keeps existing work', async ({
  page,
}, testInfo) => {
  await loadDemo(page);
  await page.goto(routes.settings);
  await page.getByTestId('reset-demo').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('alert').getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.goto(routes.home);
  await expect(page.getByRole('main')).toContainText('品牌官网焕新');

  await page.goto(routes.settings);
  await page.getByTestId('reset-demo').click();
  await capture(page, testInfo, '28-reset-confirmation');
  await page.getByRole('alert').getByRole('button', { name: '查看空状态', exact: true }).click();
  await expect(page.getByTestId('app-shell')).toHaveClass(/is-welcome/);
  await expect(page.getByTestId('decision')).toHaveCount(0);
});
