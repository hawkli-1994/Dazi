import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { HostErrorCode } from '../../src/host/errors';
import { Command } from '../../src/shared/rpc/protocol';
import { crashHost, generation, launchDesktop, rpc } from '../electron/harness';

test('relocated production package loads its assets and recovers isolated work without developer tools', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dazi package trial '));
  const metadata = JSON.parse(await readFile('package.json', 'utf8'));
  const basename = `Dazi-${metadata.version}-${process.platform}-${process.arch}-unsigned.tar.gz`;
  const archive = resolve('out', basename);
  const relocated = join(directory, 'application with spaces');
  const profile = join(directory, 'isolated profile');
  const executable =
    process.platform === 'darwin'
      ? 'Dazi.app/Contents/MacOS/Dazi'
      : process.platform === 'win32'
        ? 'Dazi.exe'
        : 'Dazi';
  let desktop: Awaited<ReturnType<typeof launchDesktop>> | undefined;
  try {
    const digest = createHash('sha256')
      .update(await readFile(archive))
      .digest('hex');
    expect(await readFile(`${archive}.sha256`, 'utf8')).toBe(`${digest}  ${basename}\n`);
    execFileSync('tar', ['-xzf', archive, '-C', directory]);
    await rename(join(directory, `Dazi-${process.platform}-${process.arch}`), relocated);
    const info = JSON.parse(await readFile(join(relocated, 'build-info.json'), 'utf8'));
    expect(info).toMatchObject({ platform: process.platform, arch: process.arch, signed: false });
    expect(info.commit).toMatch(/^[a-f0-9]{40}$/);
    const options = { executablePath: join(relocated, executable), directory: profile };
    desktop = await launchDesktop(undefined, { ...options, diagnosticName: 'packaged-initial' });
    const { application, page } = desktop;
    expect(
      await application.evaluate(({ app }) => ({
        packaged: app.isPackaged,
        name: app.getName(),
        profile: app.getPath('userData'),
        archive: app.getAppPath().endsWith('app.asar'),
        sandboxDisabled: app.commandLine.hasSwitch('no-sandbox'),
      })),
    ).toEqual({
      packaged: true,
      name: metadata.name,
      profile,
      archive: true,
      sandboxDisabled: false,
    });
    const files = await application.evaluate(({ app }) => {
      const fs = process.getBuiltinModule('fs');
      const path = process.getBuiltinModule('path');
      if (!fs || !path) throw new Error('The packaged Node filesystem is unavailable.');
      const root = app.getAppPath();
      return {
        root: fs.readdirSync(root).sort(),
        developmentDependencies: ['electron', 'vite', 'vitest', '@electron/packager'].filter(
          (name) => fs.existsSync(path.join(root, 'node_modules', name)),
        ),
      };
    });
    expect(files.root).toEqual(['dist', 'dist-desktop', 'node_modules', 'package.json']);
    expect(files.developmentDependencies).toEqual([]);
    await expect(page).toHaveTitle(/Dazi/);
    expect(
      await page.evaluate(async () => {
        const image = new Image();
        image.src = 'dazi://app/art/watercolor.webp';
        await image.decode();
        return image.naturalWidth > 0;
      }),
    ).toBe(true);
    // The fixture passes --test-provider deliberately. A real package must ignore it.
    const models = await rpc(page, Command.ListModels, {});
    expect(models.models.length).toBeGreaterThan(0);
    expect(models.models.some((model) => model.provider === 'faux')).toBe(false);
    expect(models.models.every((model) => !model.configured)).toBe(true);
    const input = {
      goal: 'Packaged desktop keeps my work',
      directory,
      requestId: crypto.randomUUID(),
    };
    const created = await rpc(page, Command.CreateWork, input);
    expect(await rpc(page, Command.CreateWork, input)).toEqual(created);
    await page.evaluate((id) => {
      location.hash = `/work/${id}`;
    }, created.workId);
    const composer = page.getByTestId('work-composer');
    await expect(composer).toBeEnabled();
    await composer.fill('Keep this unsent task while I configure a model');
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByTestId('send-message').click();
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(composer).toHaveValue('Keep this unsent task while I configure a model');
      await expect(composer).toBeEnabled();
    }
    await expect(
      rpc(page, Command.Submit, {
        workId: created.workId,
        text: 'No paid API calls',
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toThrow(HostErrorCode.ModelMissing);
    const previous = await generation(page);
    await crashHost(application);
    await expect.poll(() => generation(page), { timeout: 30_000 }).toBeGreaterThan(previous);
    await expect(composer).toHaveValue('Keep this unsent task while I configure a model');
    expect(await rpc(page, Command.ListWorks, {})).toEqual([
      expect.objectContaining({ id: created.workId, busy: false }),
    ]);
    await page.screenshot({ path: 'test-results/package/packaged-light.png' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 760, height: 640 });
    await expect(composer).toBeVisible();
    await page.screenshot({ path: 'test-results/package/packaged-dark-narrow.png' });
    await desktop.cleanup();
    expect(await readFile(test.info().outputPath('packaged-initial.log'), 'utf8')).not.toMatch(
      /\[(?:page-error|renderer-error)\]/,
    );
    desktop = await launchDesktop(undefined, { ...options, diagnosticName: 'packaged-restart' });
    expect(await rpc(desktop.page, Command.CreateWork, input)).toEqual(created);
    expect(await rpc(desktop.page, Command.ListWorks, {})).toEqual([
      expect.objectContaining({ id: created.workId, busy: false }),
    ]);
    await desktop.page.evaluate((id) => {
      location.hash = `/work/${id}`;
    }, created.workId);
    await expect(desktop.page.getByText(input.goal, { exact: true }).first()).toBeVisible();
    await expect(desktop.page.getByTestId('work-composer')).toBeEnabled();
    await desktop.cleanup();
    expect(await readFile(test.info().outputPath('packaged-restart.log'), 'utf8')).not.toMatch(
      /\[(?:page-error|renderer-error)\]/,
    );
  } finally {
    await desktop?.cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});
