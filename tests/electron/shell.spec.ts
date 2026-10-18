import { expect, test } from '@playwright/test';
import { Command } from '../../src/shared/rpc/protocol';
import { crashHost, generation, latestView, launchDesktop, rpc } from './harness';

test('sandboxed desktop exposes only the minimal bridge and denies renderer escape routes', async () => {
  const desktop = await launchDesktop();
  try {
    await desktop.application.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      const observations = {
        blocked: [] as { url: string; prevented: boolean }[],
        committed: [] as string[],
        sent: [] as string[],
        responses: [] as string[],
        rendererExits: [] as string[],
      };
      Object.defineProperty(globalThis, 'navigationSecurityObservations', {
        value: observations,
        configurable: true,
      });
      // Observe after the production handlers without replacing their policy.
      contents.on('will-frame-navigate', (event) => {
        if (event.isMainFrame) {
          observations.blocked.push({ url: event.url, prevented: event.defaultPrevented });
        }
      });
      contents.on('did-navigate', (_event, url) => observations.committed.push(url));
      contents.on('render-process-gone', (_event, details) => {
        observations.rendererExits.push(details.reason);
      });
      const filter = { urls: ['http://*/*', 'https://*/*'] };
      contents.session.webRequest.onSendHeaders(filter, (details) => {
        observations.sent.push(details.url);
      });
      contents.session.webRequest.onResponseStarted(filter, (details) => {
        observations.responses.push(details.url);
      });
    });
    await desktop.page.evaluate(() => {
      Object.defineProperty(window, 'rendererIsolationProbe', { value: 'main-world-only' });
      Object.defineProperty(window, 'rendererShellProbe', {
        value: document.querySelector('[data-testid="app-shell"]'),
      });
    });
    const isolation = await desktop.application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.executeJavaScriptInIsolatedWorld(999, [
        { code: 'typeof window.rendererIsolationProbe' },
      ]),
    );
    expect(isolation).toBe('undefined');
    expect(await desktop.application.evaluate(() => process.versions.node)).toMatch(/^24\./);
    expect(
      await desktop.application.evaluate(({ app }) => app.commandLine.hasSwitch('no-sandbox')),
    ).toBe(false);
    expect(await desktop.page.evaluate(() => Object.keys(window.daziDesktop ?? {}).sort())).toEqual(
      ['connectHost', 'onHostStatus', 'openExternal', 'selectFolder'],
    );
    // Preload exposes the bridge only after checking process.sandboxed and
    // process.contextIsolated in its own runtime, not its requested preferences.
    expect(
      await desktop.page.evaluate(() => ({
        node: 'process' in window,
        require: 'require' in window,
      })),
    ).toEqual({ node: false, require: false });
    expect(desktop.page.url()).toMatch(/^dazi:\/\/app\/index\.html/);
    for (const url of ['https://example.com/', 'file:///etc/passwd']) {
      expect(
        await desktop.page.evaluate(async (url) => {
          try {
            await fetch(url);
            return true;
          } catch {
            return false;
          }
        }, url),
      ).toBe(false);
    }
    await desktop.page.evaluate(() => {
      window.open('https://example.com/');
    });
    expect(
      await desktop.application.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(1);
    const before = await desktop.page.evaluate(() => location.href);
    await desktop.page.evaluate(() => {
      window.location.href = 'https://example.com/';
    });
    const securityObservations = () =>
      desktop.application.evaluate(() => Reflect.get(globalThis, 'navigationSecurityObservations'));
    const blockedOnly = {
      blocked: [{ url: 'https://example.com/', prevented: true }],
      committed: [],
      sent: [],
      responses: [],
      rendererExits: [],
    };
    await expect.poll(securityObservations).toEqual(blockedOnly);
    // Electron cancels before Chromium sends a navigation request. Playwright
    // can retain that provisional navigation, so toHaveURL's precheck waits
    // forever without reading location. Read the real document and Main frame;
    // do not reload, disable navigation checks, or intercept the attempted URL.
    expect(
      await desktop.application.evaluate(({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows()[0].webContents;
        return { url: contents.getURL(), frameUrl: contents.mainFrame.url };
      }),
    ).toEqual({ url: before, frameUrl: before });
    expect(
      await desktop.page.evaluate(() => ({
        url: location.href,
        identity: Reflect.get(window, 'rendererIsolationProbe'),
        sameShell:
          Reflect.get(window, 'rendererShellProbe') ===
          document.querySelector('[data-testid="app-shell"]'),
        ready: document.readyState,
        shellVisible: Boolean(
          document.querySelector('[data-testid="app-shell"]')?.getClientRects().length,
        ),
      })),
    ).toEqual({
      url: before,
      identity: 'main-world-only',
      sameShell: true,
      ready: 'complete',
      shellVisible: true,
    });
    expect(await rpc(desktop.page, Command.ListWorks, {})).toEqual([]);
    expect(await securityObservations()).toEqual(blockedOnly);
    // A blocked attempt must not discard the surviving document's automatic
    // reconnect intent. No new explicit connectHost call repairs it here.
    const previousGeneration = await generation(desktop.page);
    await crashHost(desktop.application);
    await expect
      .poll(() => generation(desktop.page), { timeout: 30_000 })
      .toBeGreaterThan(previousGeneration);
    expect(await rpc(desktop.page, Command.ListWorks, {})).toEqual([]);
    expect(await securityObservations()).toEqual(blockedOnly);
    await desktop.page.screenshot({ path: 'test-results/electron/desktop-shell.png' });
  } finally {
    await desktop.cleanup();
  }
});

test('closing the native window without a tray gracefully exits an active Host', async () => {
  const desktop = await launchDesktop();
  const mainProcess = desktop.application.process();
  let output = '';
  mainProcess.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  try {
    const created = await rpc(desktop.page, Command.CreateWork, {
      goal: 'Close safely when no system tray is available',
      directory: desktop.directory,
      requestId: crypto.randomUUID(),
    });
    await rpc(desktop.page, Command.SubscribeWork, {
      workId: created.workId,
      subscriptionId: crypto.randomUUID(),
    });
    await rpc(desktop.page, Command.Submit, {
      workId: created.workId,
      text: '[test:slow]',
      requestId: crypto.randomUUID(),
    });
    await expect
      .poll(async () =>
        JSON.stringify(await latestView(desktop.page, created.workId)).includes(
          'Deterministic recoverable stream.',
        ),
      )
      .toBe(true);
    expect(await rpc(desktop.page, Command.ListWorks, {})).toEqual([
      expect.objectContaining({ id: created.workId, busy: true }),
    ]);
    await Promise.all([
      desktop.application.waitForEvent('close'),
      desktop.application.evaluate(({ BrowserWindow }) => {
        // Use the OS-window close path; application.close() would call app.quit
        // directly and would not test the product's no-tray fallback.
        setImmediate(() => BrowserWindow.getAllWindows()[0].close());
      }),
    ]);
    expect(desktop.page.isClosed()).toBe(true);
    await expect.poll(() => mainProcess.exitCode).toBe(0);
    expect(mainProcess.signalCode).toBeNull();
    await expect.poll(() => output).toContain('[DesktopTest] host-exited {"code":0}');
  } finally {
    await desktop.cleanup();
  }
});

test('real utility process reconnects after a crash and retains SQLite work', async () => {
  const desktop = await launchDesktop();
  try {
    const created = await rpc(desktop.page, Command.CreateWork, {
      goal: 'Electron persistence check',
      directory: desktop.directory,
      requestId: crypto.randomUUID(),
    });
    expect(created).toEqual({ workId: expect.any(String) });
    const workId = (created as { workId: string }).workId;
    const previousGeneration = await generation(desktop.page);
    await crashHost(desktop.application);
    await expect
      .poll(() => generation(desktop.page), { timeout: 30_000 })
      .toBeGreaterThan(previousGeneration);
    expect(await rpc(desktop.page, Command.ListWorks, {})).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: workId })]),
    );
    const restartedGeneration = await generation(desktop.page);
    await desktop.page.reload();
    await desktop.page.evaluate(() => window.daziDesktop?.connectHost());
    await expect.poll(() => generation(desktop.page)).toBeGreaterThan(restartedGeneration);
    expect(await rpc(desktop.page, Command.ListWorks, {})).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: workId })]),
    );
  } finally {
    await desktop.cleanup();
  }
});

test('capabilities loads on a fresh renderer and reloads its models after Host reconnection', async () => {
  const desktop = await launchDesktop('/capabilities');
  try {
    const model = desktop.page.getByTestId('runtime-model');
    await expect(model).toHaveValue('faux/faux-1');
    await expect(model.locator('option[value="faux/faux-1"]')).toBeEnabled();
    await expect(desktop.page.getByRole('alert')).toHaveCount(0);
    // Clear only the local selection so a fresh listModels response is observable.
    await model.selectOption('');
    const previousGeneration = await generation(desktop.page);
    await crashHost(desktop.application);
    await expect
      .poll(() => generation(desktop.page), { timeout: 30_000 })
      .toBeGreaterThan(previousGeneration);
    await expect(model).toHaveValue('faux/faux-1');
    await expect(desktop.page.getByRole('alert')).toHaveCount(0);
  } finally {
    await desktop.cleanup();
  }
});

test('explicit web-link clicks use the narrow external bridge without allowing popups', async () => {
  const desktop = await launchDesktop();
  try {
    await desktop.application.evaluate(({ shell }) => {
      Object.defineProperty(globalThis, 'openedTestUrls', { value: [], configurable: true });
      shell.openExternal = async (url) => {
        const calls = Reflect.get(globalThis, 'openedTestUrls') as string[];
        calls.push(url);
      };
    });
    await desktop.page.evaluate(() => {
      const button = document.createElement('button');
      button.id = 'test-external-click';
      button.textContent = 'Open validated test link';
      button.onclick = () => {
        const urls = [
          'https://example.com/review',
          'javascript:alert(1)',
          'file:///etc/passwd',
          'data:text/html,test',
          'https://user:secret@example.com',
        ];
        for (const url of urls) void window.daziDesktop?.openExternal(url);
      };
      document.body.append(button);
    });
    await desktop.page.locator('#test-external-click').click();
    await expect
      .poll(() => desktop.application.evaluate(() => Reflect.get(globalThis, 'openedTestUrls')))
      .toEqual(['https://example.com/review']);
    expect(
      await desktop.application.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(1);
  } finally {
    await desktop.cleanup();
  }
});

test('a run interrupted in the actual utility process resumes without duplicate submission', async () => {
  const desktop = await launchDesktop();
  try {
    const created = (await rpc(desktop.page, Command.CreateWork, {
      goal: 'Verify real process recovery',
      directory: desktop.directory,
      requestId: crypto.randomUUID(),
    })) as { workId: string };
    await rpc(desktop.page, Command.SubscribeWork, {
      workId: created.workId,
      subscriptionId: crypto.randomUUID(),
    });
    const requestId = crypto.randomUUID();
    const submission = await rpc(desktop.page, Command.Submit, {
      workId: created.workId,
      text: '[test:slow]',
      requestId,
    });
    await expect
      .poll(async () =>
        JSON.stringify(await latestView(desktop.page, created.workId)).includes(
          'Deterministic recoverable stream.',
        ),
      )
      .toBe(true);
    const previousGeneration = await generation(desktop.page);
    await crashHost(desktop.application);
    await expect
      .poll(() => generation(desktop.page), { timeout: 30_000 })
      .toBeGreaterThan(previousGeneration);
    await rpc(desktop.page, Command.SubscribeWork, {
      workId: created.workId,
      subscriptionId: crypto.randomUUID(),
    });
    expect(
      await rpc(desktop.page, Command.Submit, {
        workId: created.workId,
        text: '[test:slow]',
        requestId,
      }),
    ).toEqual(submission);
    await expect
      .poll(
        async () => {
          const works = await rpc(desktop.page, Command.ListWorks, {});
          if (!Array.isArray(works)) return true;
          const work: unknown = works.find(
            (value: unknown) =>
              typeof value === 'object' &&
              value !== null &&
              'id' in value &&
              value.id === created.workId,
          );
          return typeof work === 'object' && work !== null && 'busy' in work ? work.busy : true;
        },
        { timeout: 30_000 },
      )
      .toBe(false);
    await expect
      .poll(async () => {
        const view = await latestView(desktop.page, created.workId);
        const final = view?.entries
          .flatMap((entry) => entry.model ?? [])
          .filter((message) => message.role === 'assistant')
          .at(-1);
        return final?.role === 'assistant'
          ? final.content
              .filter((block) => block.type === 'text')
              .map((block) => block.text)
              .join('')
          : '';
      })
      .toBe('Deterministic recoverable stream. '.repeat(60));
    await desktop.page.screenshot({ path: 'test-results/electron/recovered-run.png' });
    await expect
      .poll(async () => {
        const view = await latestView(desktop.page, created.workId);
        return view?.entries
          .flatMap((entry) => entry.model ?? [])
          .filter((message) => message.role === 'user').length;
      })
      .toBe(1);
  } finally {
    await desktop.cleanup();
  }
});
