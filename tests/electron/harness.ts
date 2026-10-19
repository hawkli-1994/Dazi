import { _electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { applyImmutable } from '@earendil-works/chord/delta';
import type { ConversationView } from '@earendil-works/pi-durable';
import { DesktopChannel } from '../../src/shared/rpc/desktop';
import { Wire, type CommandMap, type HostEvent } from '../../src/shared/rpc/protocol';
import { fixtureDiagnostics } from './diagnostics';

type SmokeState = {
  generation: number;
  port: MessagePort | null;
  messages: unknown[];
};
type SmokeWindow = Window & { electronSmoke?: SmokeState };

export async function launchDesktop(
  initialRoute?: string,
  options: { executablePath?: string; directory?: string; diagnosticName?: string } = {},
): Promise<{
  application: ElectronApplication;
  page: Page;
  directory: string;
  cleanup(): Promise<void>;
}> {
  const directory = options.directory ?? (await mkdtemp(join(tmpdir(), 'dazi-electron-')));
  const diagnostics = fixtureDiagnostics(options.diagnosticName);
  let application: ElectronApplication | undefined;
  const cleanup = async () => {
    try {
      await application?.close();
    } finally {
      await diagnostics.save();
      if (!options.directory) await rm(directory, { recursive: true, force: true });
    }
  };
  try {
    application = await _electron.launch({
      executablePath: options.executablePath,
      // Playwright otherwise adds --no-sandbox to Electron on Linux.
      chromiumSandbox: true,
      args: [
        ...(options.executablePath ? [] : [resolve('.')]),
        '--test-provider',
        '--test-without-tray',
        `--dazi-user-data=${directory}`,
      ],
      env: {
        ...Object.fromEntries(
          // Do not inherit provider credentials, tokens, NODE_OPTIONS, or arbitrary
          // app configuration into a fixture whose diagnostics are CI artifacts.
          [
            'PATH',
            'HOME',
            'TMPDIR',
            'TMP',
            'TEMP',
            'DISPLAY',
            'XAUTHORITY',
            'LANG',
            'LC_ALL',
            'CI',
            'LD_LIBRARY_PATH',
            'DBUS_SESSION_BUS_ADDRESS',
            'XDG_RUNTIME_DIR',
          ].flatMap((name) =>
            process.env[name] === undefined ? [] : [[name, process.env[name]!]],
          ),
        ),
        DAZI_RENDERER_URL: '',
        XDG_CURRENT_DESKTOP: '',
      },
    });
    diagnostics.application(application);
    const page = await application.firstWindow();
    diagnostics.page(page);
    // firstWindow() only waits for a window event, not its initial navigation.
    // Interrupting Main's loadURL before did-finish-load can reject that promise.
    await page.waitForURL(/^dazi:\/\/app\/index\.html/, { waitUntil: 'load' });
    await expect(page.getByTestId('app-shell')).toBeVisible();
    diagnostics.record('fixture', 'Initial page and UI finished loading before reload.');
    await page.addInitScript(
      ({
        portType,
        snapshotType,
        deltaType,
        ackType,
        catalogType,
        documentsType,
        noticeAckType,
        initialRoute,
      }) => {
        if (initialRoute) history.replaceState(null, '', `#${initialRoute}`);
        const state: SmokeState = { generation: 0, port: null, messages: [] };
        (window as SmokeWindow).electronSmoke = state;
        window.addEventListener('message', (event: MessageEvent<unknown>) => {
          if (
            event.source !== window ||
            event.origin !== window.location.origin ||
            event.ports.length !== 1
          )
            return;
          const value = event.data;
          if (
            typeof value !== 'object' ||
            value === null ||
            !('type' in value) ||
            value.type !== portType ||
            !('generation' in value) ||
            typeof value.generation !== 'number'
          )
            return;
          state.generation = value.generation;
          state.port = event.ports[0];
          state.port.addEventListener('message', (message: MessageEvent<unknown>) => {
            state.messages.push(message.data);
            const data = message.data;
            if (typeof data !== 'object' || data === null || !('type' in data)) return;
            if ((data.type === catalogType || data.type === documentsType) && 'noticeId' in data) {
              state.port?.postMessage({ type: noticeAckType, noticeId: data.noticeId });
            }
            // The test subscription consumes the same bounded stream as a real UI.
            if (
              (data.type === snapshotType || data.type === deltaType) &&
              'subscriptionId' in data &&
              'sequence' in data
            ) {
              state.port?.postMessage({
                type: ackType,
                subscriptionId: data.subscriptionId,
                sequence: data.sequence,
              });
            }
          });
          state.port.start();
        });
      },
      {
        portType: DesktopChannel.Port,
        snapshotType: Wire.Snapshot,
        deltaType: Wire.Delta,
        ackType: Wire.Ack,
        catalogType: Wire.Catalog,
        documentsType: Wire.Documents,
        noticeAckType: Wire.NoticeAck,
        initialRoute,
      },
    );
    // Installing the observer before a reload also exercises fresh document handshakes.
    await page.reload();
    await page.evaluate(() => window.daziDesktop?.connectHost());
    await expect.poll(() => generation(page), { timeout: 30_000 }).toBeGreaterThan(0);
    return {
      application,
      page,
      directory,
      cleanup,
    };
  } catch (error) {
    diagnostics.record(
      'setup-failed',
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    await cleanup();
    throw error;
  }
}

export async function generation(page: Page): Promise<number> {
  return page.evaluate(() => (window as SmokeWindow).electronSmoke?.generation ?? 0);
}

export async function rpc<K extends keyof CommandMap>(
  page: Page,
  command: K,
  input: CommandMap[K]['input'],
): Promise<CommandMap[K]['output']> {
  const result = await page.evaluate(
    ({ command, input, requestType, responseType }) => {
      const port = (window as SmokeWindow).electronSmoke?.port;
      if (!port) throw new Error('The utility process port is not connected.');
      return new Promise<unknown>((resolve, reject) => {
        const id = crypto.randomUUID();
        const timeout = setTimeout(() => {
          port.removeEventListener('message', receive);
          reject(new Error(`RPC timed out: ${command}`));
        }, 15_000);
        const receive = (event: MessageEvent<unknown>) => {
          const message = event.data;
          if (
            typeof message !== 'object' ||
            message === null ||
            !('type' in message) ||
            message.type !== responseType ||
            !('id' in message) ||
            message.id !== id
          )
            return;
          clearTimeout(timeout);
          port.removeEventListener('message', receive);
          if ('ok' in message && message.ok && 'value' in message) resolve(message.value);
          else reject(new Error('error' in message ? String(message.error) : 'RPC rejected.'));
        };
        port.addEventListener('message', receive);
        port.postMessage({ type: requestType, id, command, input });
      });
    },
    { command, input, requestType: Wire.Request, responseType: Wire.Response },
  );
  return result as CommandMap[K]['output'];
}

export async function messages(page: Page): Promise<unknown[]> {
  return page.evaluate(() => (window as SmokeWindow).electronSmoke?.messages ?? []);
}

/** Reconstruct the actual wire projection, including incremental string ops. */
export async function latestView(page: Page, workId: string): Promise<ConversationView | null> {
  const events = (await messages(page)) as HostEvent[];
  let view: ConversationView | null = null;
  let subscriptionId = '';
  let sequence = -1;
  for (const event of events) {
    if (event.type === Wire.Snapshot && event.workId === workId) {
      view = event.value;
      subscriptionId = event.subscriptionId;
      sequence = event.sequence;
    } else if (
      event.type === Wire.Delta &&
      event.workId === workId &&
      event.subscriptionId === subscriptionId &&
      event.sequence > sequence &&
      view
    ) {
      if (event.sequence !== sequence + 1) throw new Error('The real Host stream skipped a frame.');
      view = applyImmutable(view, event.ops);
      sequence = event.sequence;
    }
  }
  return view;
}

export async function crashHost(application: ElectronApplication): Promise<number> {
  return application.evaluate(({ app }) => {
    const host = app.getAppMetrics().find((metric) => metric.name === 'Dazi Agent Host');
    if (!host) throw new Error('The actual utility process was not found.');
    process.kill(host.pid, 'SIGKILL');
    return host.pid;
  });
}
