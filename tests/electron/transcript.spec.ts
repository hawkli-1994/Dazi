import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { launchDesktop } from './harness';

const cases = [
  { name: 'light', colorScheme: 'light', width: 1280, height: 860 },
  { name: 'dark', colorScheme: 'dark', width: 1280, height: 860 },
  { name: 'narrow', colorScheme: 'light', width: 960, height: 720 },
] as const;

async function capture(page: Page, info: TestInfo, name: string): Promise<void> {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: 'image/png' });
}

for (const variant of cases) {
  test(`native thinking, live tool output, final reply and reload in ${variant.name}`, async () => {
    const info = test.info();
    const desktop = await launchDesktop();
    const { page, application, directory } = desktop;
    try {
      await application.evaluate(
        ({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height);
        },
        { width: variant.width, height: variant.height },
      );
      await page.emulateMedia({ colorScheme: variant.colorScheme, reducedMotion: 'reduce' });
      await page.evaluate(() => {
        window.location.hash = '/new';
      });
      await page.getByTestId('new-work-goal').fill('验证真实流式工作对话');
      await page.getByTestId('new-work-directory').fill(directory);
      await page.getByTestId('create-work').click();
      await expect(page).toHaveURL(/#\/work\/\d+$/);
      await expect(page.getByTestId('work-composer')).toBeEnabled();
      const prompt = '[test:tool] [test:slow] [test:visual]';
      await page.getByTestId('work-composer').fill(prompt);
      await page.getByTestId('send-message').click();

      const liveReasoning = page
        .locator('.agent-message[data-live="true"] .agent-reasoning')
        .first();
      await expect(liveReasoning).toBeVisible();
      await liveReasoning.locator('summary').click();
      await expect(liveReasoning).toHaveAttribute('open', '');
      await capture(page, info, `${variant.name}-01-live-thinking`);

      const tool = page.locator('.agent-tool').filter({ hasText: 'dazi_test_progress' }).first();
      await expect(tool.locator('[data-state="running"]')).toBeVisible();
      await tool.locator('summary').click();
      await expect(tool).toContainText('test output 1');
      await expect(tool.locator('[data-state="running"]')).toBeVisible();
      await capture(page, info, `${variant.name}-02-running-tool`);
      await expect(tool).toContainText('test output 2');
      await expect(tool.locator('[data-state="running"]')).toBeVisible();
      await capture(page, info, `${variant.name}-03-tool-output-update`);

      const liveText = page
        .locator('.agent-message[data-live="true"]')
        .filter({ hasText: 'Deterministic recoverable stream.' });
      await expect(liveText).toBeVisible({ timeout: 15_000 });
      await capture(page, info, `${variant.name}-04-live-text`);
      await expect(page.locator('.agent-message[data-live="true"]')).toHaveCount(0, {
        timeout: 30_000,
      });
      await expect(tool.locator('[data-state="success"]')).toBeVisible();
      await expect(
        page.locator('.agent-markdown').filter({ hasText: 'Deterministic recoverable stream.' }),
      ).toHaveText('Deterministic recoverable stream. '.repeat(60).trim());
      await expect(page.locator('.agent-user-text').filter({ hasText: prompt })).toHaveCount(1);
      await expect(page.locator('html')).toHaveAttribute('data-theme', variant.colorScheme);
      await capture(page, info, `${variant.name}-05-final-transcript`);

      // A document reload gets a fresh MessagePort and current committed view.
      await page.reload();
      await expect(page.locator('.agent-tool [data-state="success"]')).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        page.locator('.agent-markdown').filter({ hasText: 'Deterministic recoverable stream.' }),
      ).toHaveText('Deterministic recoverable stream. '.repeat(60).trim());
      await expect(page.locator('.agent-user-text').filter({ hasText: prompt })).toHaveCount(1);
      await expect(page.locator('.agent-reasoning')).not.toHaveCount(0);
      await capture(page, info, `${variant.name}-06-restored-transcript`);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    } finally {
      await desktop.cleanup();
    }
  });
}
