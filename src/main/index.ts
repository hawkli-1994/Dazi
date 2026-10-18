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

function createWindow(): BrowserWindow {
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
      documentEpoch++;
      supervisor?.detachRenderer();
    }
  });
  created.webContents.on('render-process-gone', () => supervisor?.detachRenderer());
  created.on('close', (event) => {
    if (!quitting && tray) {
      event.preventDefault();
      created.hide();
    }
  });
  created.on('closed', () => {
    supervisor?.detachRenderer();
    window = null;
  });
  created.once('ready-to-show', () => created.show());
  void created.loadURL(entry).catch(() => {
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
    spawn: () =>
      utilityProcess.fork(
        join(root, 'dist-desktop/host/index.js'),
        [
          '--storage-path',
          join(app.getPath('userData'), 'dazi.sqlite'),
          ...(testProvider ? ['--test-provider'] : []),
        ],
        { serviceName: 'Dazi Agent Host', stdio: 'inherit' },
      ),
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

  tray = createTray(() => showWindow(window ?? createWindow()));
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
  void startDesktop().catch(() => {
    console.error('[Desktop] Desktop initialization failed.');
    app.quit();
  });
}
