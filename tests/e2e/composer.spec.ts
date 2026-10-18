import { capture, createWork, expect, routes, test } from './fixtures';

test('a new thought is queued locally without inventing a reply', async ({ page }, testInfo) => {
  await page.goto(routes.home);
  const welcomeTitle = await page.getByRole('heading', { level: 1 }).innerText();
  await createWork(page);
  const composer = page.getByTestId('work-composer');
  const message = '先核对三处数据，再决定是否发布。';
  await composer.fill(message);
  await page.getByTestId('send-message').click();
  await expect(composer).toHaveValue('');
  await expect(page.getByText(message, { exact: true })).toHaveCount(1);
  await expect(page.getByRole('main')).toContainText('不会执行任务或生成回复');
  await capture(page, testInfo, '06-local-message');

  // Empty repeated submissions must not create duplicate messages.
  await composer.press('Enter');
  await composer.press('Enter');
  await expect(page.getByText(message, { exact: true })).toHaveCount(1);

  // The demo makes its reset boundary explicit instead of promising durability.
  await page.reload();
  await expect(page.getByRole('main')).toContainText('这项工作已不在当前演示中');
  await page.goto(routes.home);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(welcomeTitle);
});

test('Enter respects composition events and Shift+Enter keeps a newline', async ({
  page,
}, testInfo) => {
  await createWork(page);
  const composer = page.getByTestId('work-composer');
  const message = '输入法还在选择文字';
  await composer.fill(message);
  await composer.dispatchEvent('compositionstart', { data: '字' });
  await composer.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    isComposing: true,
    bubbles: true,
  });
  await expect(composer).toHaveValue(message);
  await composer.dispatchEvent('compositionend', { data: '字' });

  // Some input methods report keyCode 229 with isComposing already false.
  await composer.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    keyCode: 229,
    isComposing: false,
    bubbles: true,
  });
  await expect(composer).toHaveValue(message);
  await composer.press('End');
  await composer.press('Shift+Enter');
  await composer.pressSequentially('Second line');
  await expect(composer).toHaveValue(`${message}\nSecond line`);
  await capture(page, testInfo, '07-keyboard-composer');
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  await expect(page.getByText(`${message} Second line`, { exact: true })).toHaveCount(1);
});

test('long mixed-language content stays readable inside the viewport', async ({
  page,
}, testInfo) => {
  const goal = '整理下一次发布的计划，保留每一个待确认事项。'.repeat(8);
  await createWork(page, {
    goal,
    directory: `/demo/${'very-long-work-directory-without-natural-breaks'.repeat(5)}`,
  });
  const composer = page.getByTestId('work-composer');
  await composer.fill(
    `先看结论，再查看详情。\n${'VeryLongUnbrokenReference'.repeat(30)}\n${'中文段落。'.repeat(60)}`,
  );
  await page.getByTestId('send-message').click();
  await expect(composer).toHaveValue('');
  await capture(page, testInfo, '08-long-content');
  const toggle = page.getByTestId('work-record-toggle');
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await capture(page, testInfo, '09-long-content-notes');
});
