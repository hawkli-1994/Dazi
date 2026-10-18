import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  MessageChannelMain,
  protocol,
  session,
  shell,
  utilityProcess,
  type Tray,
} from 'electron';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DesktopChannel, externalWebUrl, HostControl } from '../shared/rpc/desktop';
import { HostSupervisor } from './host-supervisor';
import { createTray, showWindow } from './native-ui';
import { isSupersededLoadAbort, navigationErrorCode } from './navigation';
import {
  allowsRendererRequest,
  AppScheme,
  isTrustedDocument,
  isTrustedSender,
  rendererCsp,
  rendererEntry,
  resolveAppAsset,
} from './security';

const root = fileURLToPath(new URL('../../', import.meta.url));
const rendererRoot = join(root, 'dist');
const entry = rendererEntry(process.env.DAZI_RENDERER_URL, app.isPackaged);
const testProvider = !app.isPackaged && process.argv.includes('--test-provider');
const testUserData = process.argv.find((argument) => argument.startsWith('--dazi-user-data='));
if (testProvider && testUserData) {
  const path = testUserData.slice('--dazi-user-data='.length);
  if (!isAbsolute(path)) throw new Error('Test user data directory must be absolute.');
  app.setPath('userData', path);
}

protocol.registerSchemesAsPrivileged([
  { scheme: AppScheme, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let supervisor: HostSupervisor | null = null;
let quitting = false;
let quitAllowed = false;
let selectingFolder = false;
let documentEpoch = 0;

function testDiagnostic(event: string, details: Record<string, unknown> = {}): void {
  if (testProvider) console.info(`[DesktopTest] ${event} ${JSON.stringify(details)}`);
}

function createWindow(): BrowserWindow {
  let navigations = 0;
  let latestNavigation = '';
  const created = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 540,
    show: false,
    title: 'Dazi',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(root, 'dist-desktop/main/preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
    },
  });
  window = created;
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  created.webContents.on('will-navigate', (event) => event.preventDefault());
  created.webContents.on('will-frame-navigate', (event) => event.preventDefault());
  created.webContents.on('will-redirect', (event) => event.preventDefault());
  created.webContents.on('will-attach-webview', (event) => event.preventDefault());
  created.webContents.on('did-start-navigation', (event) => {
    if (event.isMainFrame && !event.isSameDocument) {
      navigations++;
      latestNavigation = event.url;
      documentEpoch++;
      testDiagnostic('navigation-started', { navigations, url: event.url });
    }
  });
  // did-start-navigation precedes the cancellable will-frame-navigate event.
  // A denied attempt leaves the current document and its port alive; revoke the
  // reconnect intent only when a replacement main-frame document commits.
  created.webContents.on('did-navigate', (_event, url) => {
    testDiagnostic('navigation-committed', { url });
    supervisor?.detachRenderer();
  });
  created.webContents.on('render-process-gone', (_event, details) => {
    testDiagnostic('renderer-exited', { reason: details.reason, exitCode: details.exitCode });
    supervisor?.detachRenderer();
  });
  if (testProvider) {
    created.webContents.on('did-finish-load', () => testDiagnostic('navigation-finished'));
    created.webContents.on('did-fail-load', (_event, code, description, url, mainFrame) => {
      testDiagnostic('navigation-failed', { code, description, url, mainFrame });
    });
    created.webContents.on('preload-error', (_event, path, error) => {
      testDiagnostic('preload-failed', { path, message: error.message, stack: error.stack });
    });
  }
  created.on('close', (event) => {
    if (!quitting && tray) {
      event.preventDefault();
      created.hide();
    }
  });
  created.on('closed', () => {
    testDiagnostic('window-closed');
    supervisor?.detachRenderer();
    window = null;
  });
  created.once('ready-to-show', () => created.show());
  const initialNavigation = navigations + 1;
  void created.loadURL(entry).catch((error: unknown) => {
    testDiagnostic('initial-load-rejected', {
      code: navigationErrorCode(error),
      initialNavigation,
      navigations,
      latestNavigation,
    });
    if (
      quitting ||
      created.isDestroyed() ||
      isSupersededLoadAbort(error, initialNavigation, navigations, latestNavigation, entry)
    )
      return;
    console.error('[Desktop] The application window could not load.');
    app.quit();
  });
  return created;
}

async function startDesktop(): Promise<void> {
  await app.whenReady();
  const rendererSession = session.defaultSession;
  const assetSession = session.fromPartition('dazi-static-assets');
  rendererSession.setPermissionCheckHandler(() => false);
  rendererSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  rendererSession.on('will-download', (event) => event.preventDefault());
  rendererSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !allowsRendererRequest(details.url, entry) });
  });
  rendererSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [rendererCsp(entry)],
        'X-Content-Type-Options': ['nosniff'],
      },
    });
  });
  protocol.handle(AppScheme, async (request) => {
    const asset = resolveAppAsset(request.url, rendererRoot);
    if (!asset || request.method !== 'GET') return new Response(null, { status: 403 });
    try {
      // A separate, inaccessible session serves bundled files; the renderer's
      // session remains unable to request arbitrary file:// or network URLs.
      const response = await assetSession.fetch(pathToFileURL(asset).href);
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', rendererCsp(entry));
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response(null, { status: 404 });
    }
  });

  supervisor = new HostSupervisor({
    spawn: () => {
      const child = utilityProcess.fork(
        join(root, 'dist-desktop/host/index.js'),
        [
          '--storage-path',
          join(app.getPath('userData'), 'dazi.sqlite'),
          ...(testProvider ? ['--test-provider'] : []),
        ],
        { serviceName: 'Dazi Agent Host', stdio: 'inherit' },
      );
      if (testProvider) {
        child.once('spawn', () => testDiagnostic('host-spawned', { pid: child.pid }));
        child.once('exit', (code) => testDiagnostic('host-exited', { code }));
      }
      return child;
    },
    connect: (child, generation) => {
      const contents = window?.webContents;
      if (!contents || contents.isDestroyed() || !isTrustedDocument(contents.getURL(), entry)) {
        return false;
      }
      const { port1, port2 } = new MessageChannelMain();
      try {
        child.postMessage({ type: HostControl.Connect, generation }, [port1]);
        contents.mainFrame.postMessage(
          DesktopChannel.Port,
          { type: DesktopChannel.Port, generation },
          [port2],
        );
        return true;
      } catch {
        port1.close();
        port2.close();
        return false;
      }
    },
    status: (status) => {
      testDiagnostic('host-status', { ...status });
      const contents = window?.webContents;
      if (contents && !contents.isDestroyed() && isTrustedDocument(contents.getURL(), entry)) {
        contents.mainFrame.send(DesktopChannel.Status, status);
      }
    },
  });

  ipcMain.on(DesktopChannel.Connect, (event) => {
    if (!window || !isTrustedSender(event, window.webContents, entry)) return;
    supervisor?.requestConnection();
  });
  ipcMain.handle(DesktopChannel.SelectFolder, async (event) => {
    const currentWindow = window;
    if (!currentWindow || !isTrustedSender(event, currentWindow.webContents, entry)) {
      throw new Error('Untrusted desktop request.');
    }
    if (selectingFolder) return null;
    const requestedEpoch = documentEpoch;
    selectingFolder = true;
    try {
      const result = await dialog.showOpenDialog(currentWindow, {
        properties: ['openDirectory', 'createDirectory'],
      });
      // A reload while the native dialog is open revokes this document's reply.
      if (
        requestedEpoch !== documentEpoch ||
        !window ||
        !isTrustedSender(event, window.webContents, entry)
      )
        return null;
      return result.canceled ? null : (result.filePaths[0] ?? null);
    } finally {
      selectingFolder = false;
    }
  });
  ipcMain.handle(DesktopChannel.OpenExternal, async (event, value: unknown) => {
    if (!window || !isTrustedSender(event, window.webContents, entry)) {
      throw new Error('Untrusted desktop request.');
    }
    const url = externalWebUrl(value);
    if (!url) return false;
    try {
      await shell.openExternal(url);
      return true;
    } catch {
      return false;
    }
  });

  const testWithoutTray = testProvider && process.argv.includes('--test-without-tray');
  tray = testWithoutTray ? null : createTray(() => showWindow(window ?? createWindow()));
  testDiagnostic('tray-availability', { available: Boolean(tray) });
  createWindow();
  supervisor.start();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow(window ?? createWindow()));
  app.on('activate', () => {
    if (!quitting) showWindow(window ?? createWindow());
  });
  app.on('window-all-closed', () => {
    if (!tray) app.quit();
  });
  app.on('before-quit', (event) => {
    testDiagnostic('before-quit', { quitAllowed, quitting });
    if (quitAllowed) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void (supervisor?.shutdown() ?? Promise.resolve()).finally(() => {
      tray?.destroy();
      tray = null;
      quitAllowed = true;
      app.quit();
    });
  });
  if (testProvider) {
    app.on('child-process-gone', (_event, details) => {
      testDiagnostic('child-process-exited', {
        type: details.type,
        reason: details.reason,
        exitCode: details.exitCode,
        name: details.name,
      });
    });
    app.on('quit', (_event, code) => testDiagnostic('app-quit', { code }));
  }
  void startDesktop().catch(() => {
    console.error('[Desktop] Desktop initialization failed.');
    app.quit();
  });
}
