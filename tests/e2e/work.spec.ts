import { capture, expect, loadDemo, test } from './fixtures';

for (const decision of [
  { name: 'approval', button: '就从这个方向开始', result: '已记录：同意这个方向' },
  { name: 'decline', button: '先不做', result: '已记录：先不做' },
]) {
  test(`decision ${decision.name} remains an explicit local choice`, async ({ page }, testInfo) => {
    await loadDemo(page);
    await page.goto('/#/work/brand-website');
    await capture(page, testInfo, '13-work-conversation');
    const card = page.getByTestId('decision');
    await card.locator('summary').click();
    await expect(card.locator('pre')).toBeVisible();
    await expect(card).toContainText('不会发送或发布任何内容');
    await capture(page, testInfo, '14-decision-preview');
    await card.getByRole('button', { name: decision.button, exact: true }).click();
    await expect(card.getByRole('status')).toContainText(decision.result);
    await expect(card.getByRole('button')).toHaveCount(0);
    await capture(page, testInfo, `15-decision-${decision.name}`);
    await page.goto('/#/');
    await expect(page.getByTestId('decision')).toHaveCount(0);
    await page.goBack();
    await expect(page.getByTestId('decision').getByRole('status')).toContainText(decision.result);
  });
}

test('notes, deliverables, plan, and schedule are editable and reviewable', async ({
  page,
}, testInfo) => {
  await loadDemo(page);
  await page.goto('/#/work/brand-website');
  const panel = page.locator('#work-record');
  const toggle = page.getByTestId('work-record-toggle');
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await panel.getByRole('button', { name: '修改', exact: true }).first().click();
  const note = '保留现有标识，优先让首页的文字更清楚。';
  await panel.getByLabel('纠正这条档案').fill(note);
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await expect(panel.getByText(note, { exact: true })).toBeVisible();
  await capture(page, testInfo, '16-corrected-notes');

  await panel.getByRole('button', { name: '产物', exact: true }).click();
  await panel.locator('summary').filter({ hasText: '首页内容草稿' }).click();
  await expect(panel.locator('pre').first()).toBeVisible();
  await expect(panel).toContainText('不是电脑上的实际文件');
  await capture(page, testInfo, '17-deliverable-preview');

  await panel.getByRole('button', { name: '计划', exact: true }).click();
  await expect(panel.getByRole('listitem')).toHaveCount(3);
  await capture(page, testInfo, '18-work-plan');

  await panel.getByRole('button', { name: '定时推进', exact: true }).click();
  await panel.getByLabel('启用定时推进').check();
  await panel.getByLabel('重复周期').selectOption('weekdays');
  await panel.getByLabel('时间', { exact: true }).fill('10:30');
  await panel.getByLabel('届时做什么').fill('整理最新的工作记录，列出需要确认的事项。');
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('定时设置已保存到本次演示');
  await expect(panel).toContainText('不会在后台触发');
  await capture(page, testInfo, '19-demo-schedule');
  await page.goto('/#/work/quarterly-review');
  await page.goto('/#/work/brand-website');
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await panel.getByRole('button', { name: '定时推进', exact: true }).click();
  await expect(panel.getByLabel('启用定时推进')).toBeChecked();
  await expect(panel.getByLabel('时间', { exact: true })).toHaveValue('10:30');
});

test('interrupted work can retry and running samples can stop', async ({ page }, testInfo) => {
  await loadDemo(page);
  await page.goto('/#/work/weekly-insights');
  await expect(page.getByRole('status')).toContainText('示例任务上次未完成');
  await capture(page, testInfo, '20-interrupted-work');
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('不会执行任务或生成回复');
  await capture(page, testInfo, '21-retry-queued');

  await page.goto('/#/work/onboarding-flow');
  await expect(page.getByRole('button', { name: '停止', exact: true })).toBeVisible();
  await capture(page, testInfo, '22-running-sample');
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('没有后台任务在运行');
  await expect(page.getByRole('button', { name: '重试', exact: true })).toBeVisible();
});

test('archive can be cancelled and disables further submissions after confirmation', async ({
  page,
}, testInfo) => {
  await loadDemo(page);
  await page.goto('/#/work/quarterly-review');
  await page.getByRole('button', { name: '归档工作', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByTestId('work-composer')).toBeEnabled();
  await page.getByRole('button', { name: '归档工作', exact: true }).click();
  await page.getByRole('button', { name: '归档工作', exact: true }).click();
  await expect(page.getByTestId('work-composer')).toBeDisabled();
  await expect(page.getByRole('main')).toContainText('归档工作不能继续添加消息');
  await capture(page, testInfo, '23-archived-work');
});
