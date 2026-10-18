import { expect, test, type Page } from '@playwright/test';
import { Command, Wire, type CommandMap } from '../../src/shared/rpc/protocol';
import { t } from '../../src/renderer/i18n';
import { rt } from '../../src/renderer/i18n/runtime';
import { launchDesktop } from './harness';

type DeferredWindow = Window & {
  electronSmoke?: { port: MessagePort | null };
  deferredRpcHeld?: boolean;
  releaseDeferredRpc?: () => void;
};

/** Delay a real request, then deliver it unchanged to the actual utility process. */
async function deferNextRequest(page: Page, command: keyof CommandMap): Promise<void> {
  await page.evaluate(
    ({ command, requestType }) => {
      const target = window as DeferredWindow;
      const port = target.electronSmoke?.port;
      if (!port) throw new Error('The real Host port is not connected.');
      const original = port.postMessage.bind(port);
      target.deferredRpcHeld = false;
      port.postMessage = (
        message: unknown,
        options?: Transferable[] | StructuredSerializeOptions,
      ) => {
        const deliver = () => {
          if (Array.isArray(options)) original(message, options);
          else original(message, options);
        };
        if (
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === requestType &&
          'command' in message &&
          message.command === command
        ) {
          port.postMessage = original;
          target.deferredRpcHeld = true;
          target.releaseDeferredRpc = () => {
            delete target.releaseDeferredRpc;
            deliver();
          };
        } else deliver();
      };
    },
    { command, requestType: Wire.Request },
  );
}

async function releaseRequest(page: Page): Promise<void> {
  await page.evaluate(() => {
    const release = (window as DeferredWindow).releaseDeferredRpc;
    if (!release) throw new Error('No real request was deferred.');
    release();
  });
}

test('pending native form saves prevent edits until the real Host confirms', async () => {
  const desktop = await launchDesktop();
  const { page, directory } = desktop;
  try {
    await page.evaluate(() => {
      window.location.hash = '/new';
    });
    const goal = page.getByTestId('new-work-goal');
    const folder = page.getByTestId('new-work-directory');
    await goal.fill('Keep the submitted work goal intact');
    await folder.fill(directory);
    await deferNextRequest(page, Command.CreateWork);
    await page.getByTestId('create-work').click();
    await expect
      .poll(() => page.evaluate(() => (window as DeferredWindow).deferredRpcHeld))
      .toBe(true);
    await expect(goal).toBeDisabled();
    await expect(folder).toBeDisabled();
    await expect(page.getByRole('button', { name: '选择工作目录', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: t('zh', 'cancel'), exact: true })).toBeDisabled();
    await releaseRequest(page);
    await expect(page).toHaveURL(/#\/work\/\d+$/);
    await expect(page.getByTestId('work-composer')).toBeEnabled();

    await page.getByRole('button', { name: t('zh', 'schedule'), exact: true }).click();
    // The wrapping label's text includes all options; use the select's computed accessible name.
    const frequency = page.getByRole('combobox', {
      name: t('zh', 'scheduleFrequency'),
      exact: true,
    });
    const time = page.getByLabel(t('zh', 'scheduleTime'), { exact: true });
    const prompt = page.getByRole('textbox', { name: t('zh', 'schedulePrompt'), exact: true });
    const enabled = page.getByRole('checkbox', { name: t('zh', 'scheduleEnabled'), exact: true });
    for (const field of [frequency, time, prompt, enabled]) {
      await expect(field).toBeVisible();
      await expect(field).toBeEnabled();
    }
    await expect(frequency).toHaveAccessibleName(t('zh', 'scheduleFrequency'));
    await frequency.selectOption('weekdays');
    await time.fill('15:30');
    await prompt.fill('Keep the submitted schedule text intact');
    await deferNextRequest(page, Command.SetSchedule);
    await page.getByRole('button', { name: t('zh', 'save'), exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as DeferredWindow).deferredRpcHeld))
      .toBe(true);
    for (const field of [frequency, time, prompt, enabled]) await expect(field).toBeDisabled();
    await releaseRequest(page);
    for (const field of [frequency, time, prompt, enabled]) await expect(field).toBeEnabled();
    await expect(frequency).toHaveValue('weekdays');
    await expect(time).toHaveValue('15:30');
    await expect(prompt).toHaveValue('Keep the submitted schedule text intact');
    await expect(page.getByText('已保存', { exact: true })).toBeVisible();
    // Scheduling remains disabled; this regression never triggers provider work.
    await expect(enabled).not.toBeChecked();

    await page.evaluate(() => {
      window.location.hash = '/capabilities';
    });
    const model = page.getByTestId('runtime-model');
    await expect(model).not.toHaveValue('');
    const selectedModel = await model.inputValue();
    const saveModel = page.getByRole('button', { name: rt('zh', 'saveModel'), exact: true });
    await deferNextRequest(page, Command.ConfigureModel);
    await saveModel.click();
    await expect
      .poll(() => page.evaluate(() => (window as DeferredWindow).deferredRpcHeld))
      .toBe(true);
    await expect(model).toBeDisabled();
    await expect(saveModel).toBeDisabled();
    await releaseRequest(page);
    await expect(model).toBeEnabled();
    await expect(model).toHaveValue(selectedModel);
    await expect(page.getByText(rt('zh', 'modelSaved'), { exact: true })).toBeVisible();
  } finally {
    await desktop.cleanup();
  }
});
