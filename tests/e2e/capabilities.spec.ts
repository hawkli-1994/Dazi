import { capture, expect, routes, test } from './fixtures';

test('capability drafts preview, retain local choices, and reject credential-bearing endpoints', async ({
  page,
}, testInfo) => {
  await page.goto(routes.capabilities);
  await page.getByTestId('model-name').fill('写作模型草稿');
  await page.getByTestId('model-preview').click();
  await expect(page.getByTestId('model-save')).toBeVisible();
  await capture(page, testInfo, '31-model-draft-preview');
  await page.getByTestId('model-save').click();
  await expect(page.getByTestId('model-save')).toHaveCount(0);
  await page.getByRole('navigation').getByRole('link', { name: '设置', exact: true }).click();
  await page.getByRole('navigation').getByRole('link', { name: '能力', exact: true }).click();
  await expect(page.getByTestId('model-name')).toHaveValue('写作模型草稿');

  await page.getByTestId('tool-name').fill('资料整理工具');
  for (const endpoint of [
    'https://demo-user:example-password@tools.example.invalid/mcp',
    'https://tools.example.invalid/mcp?mode=demo',
  ]) {
    await page.getByTestId('tool-endpoint').fill(endpoint);
    await page.getByTestId('tool-preview').click();
    await expect(page.getByTestId('tool-endpoint')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#tool-error')).toHaveAttribute('role', 'alert');
    await expect(page.locator('#tool-error')).not.toBeEmpty();
    await expect(page.getByTestId('tool-save')).toHaveCount(0);
  }
  await page.getByTestId('tool-endpoint').fill('https://tools.example.invalid/mcp');
  await page.getByTestId('tool-preview').click();
  await expect(page.getByTestId('tool-save')).toBeVisible();
  await page.getByTestId('tool-save').click();
  await expect(page.getByTestId('tool-draft')).toHaveCount(1);
  await expect(page.getByTestId('tool-draft')).toContainText('资料整理工具');
  await capture(page, testInfo, '32-local-tool-draft');

  for (const [id, initiallyEnabled] of [
    ['skill-writing', true],
    ['skill-research', false],
    ['skill-planning', true],
  ] as const) {
    await expect(page.getByTestId(id)).toHaveAttribute('aria-pressed', String(initiallyEnabled));
    await page.getByTestId(id).click();
    await expect(page.getByTestId(id)).toHaveAttribute('aria-pressed', String(!initiallyEnabled));
  }
  await capture(page, testInfo, '33-local-skill-choices');
  await page.getByRole('navigation').getByRole('link', { name: '设置', exact: true }).click();
  await page.getByRole('navigation').getByRole('link', { name: '能力', exact: true }).click();
  await expect(page.getByTestId('skill-research')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('tool-draft')).toHaveCount(1);
  await page.getByTestId('tool-remove').click();
  await expect(page.getByTestId('tool-remove-confirm')).toBeVisible();
  await page.getByTestId('tool-draft').getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByTestId('tool-draft')).toHaveCount(1);
  await page.getByTestId('tool-remove').click();
  await page.getByTestId('tool-remove-confirm').click();
  await expect(page.getByTestId('tool-draft')).toHaveCount(0);
});
