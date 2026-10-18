import { capture, createWork, expect, loadDemo, routes, test } from './fixtures';

test('work notes support keyboard dismissal and return focus to their control', async ({
  page,
  viewport,
}, testInfo) => {
  await loadDemo(page);
  await page.goto('/#/work/brand-website');
  const toggle = page.getByTestId('work-record-toggle');
  const panel = page.locator('#work-record');
  const isNarrow = (viewport?.width ?? 1280) <= 1100;
  if (isNarrow) {
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await toggle.press('Enter');
    const drawer = page.getByRole('dialog', { name: '工作档案', exact: true });
    await expect(drawer).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await capture(page, testInfo, '30-notes-drawer-keyboard');
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.press('Enter');
    await drawer.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(drawer).toHaveCount(0);
    await expect(toggle).toBeFocused();
  } else {
    await expect(panel).toBeVisible();
    await toggle.press('Enter');
    await expect(panel).toHaveCount(0);
    await expect(toggle).toBeFocused();
    await toggle.press('Enter');
    await expect(panel).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await capture(page, testInfo, '30-notes-panel-keyboard');
  }
});

test('required fields explain errors and work can be created with the keyboard', async ({
  page,
}, testInfo) => {
  await page.goto(routes.newWork);
  const goal = page.getByTestId('new-work-goal');
  const directory = page.getByTestId('new-work-directory');
  await page.getByTestId('create-work').click();
  await expect(page.getByRole('alert')).toHaveText('先写下你想完成的事。');
  await goal.fill('整理下一次发布的待办');
  await page.getByTestId('create-work').click();
  await expect(page.getByRole('alert')).toHaveText('请填写一个工作目录。');
  await capture(page, testInfo, '10-inline-validation');

  await goal.focus();
  await page.keyboard.press('Tab');
  await expect(directory).toBeFocused();
  expect(await directory.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
  const focusStyle = await directory.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: Number.parseFloat(style.outlineWidth), style: style.outlineStyle };
  });
  expect(focusStyle.width).toBeGreaterThanOrEqual(2);
  expect(focusStyle.style).not.toBe('none');
  await directory.fill('/demo/keyboard-work');
  await capture(page, testInfo, '11-visible-keyboard-focus');
  await directory.press('Enter');
  await expect(page).toHaveURL(/#\/work\//);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('整理下一次发布的待办');
});

test('reduced motion leaves the UI usable without animated movement', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await createWork(page);
  await page.getByTestId('work-record-toggle').click();
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
    true,
  );
  const animatedElements = await page.evaluate(() => {
    const hasDuration = (value: string) =>
      value.split(',').some((part) => Number.parseFloat(part) > 0);
    return Array.from(document.querySelectorAll('*'))
      .filter((element) => {
        const style = getComputedStyle(element);
        return hasDuration(style.animationDuration) || hasDuration(style.transitionDuration);
      })
      .map((element) => element.tagName);
  });
  expect(animatedElements).toEqual([]);
  await capture(page, testInfo, '12-reduced-motion');
});
