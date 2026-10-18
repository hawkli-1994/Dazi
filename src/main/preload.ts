import { contextBridge, ipcRenderer } from 'electron';
import {
  DesktopChannel,
  externalWebUrl,
  isHostPortMessage,
  isHostStatus,
  type DesktopBridge,
  type HostStatus,
} from '../shared/rpc/desktop';

// Fail closed if a future window change accidentally weakens this boundary.
if (!process.contextIsolated || !process.sandboxed) {
  throw new Error('The desktop bridge requires an isolated, sandboxed renderer.');
}

// Only Main can deliver this IPC. Never accept a renderer-supplied IPC channel,
// file path, or port. This listener must exist before React asks to connect.
ipcRenderer.on(DesktopChannel.Port, (event, value: unknown) => {
  if (!isHostPortMessage(value) || event.ports.length !== 1) {
    for (const port of event.ports) port.close();
    return;
  }
  window.postMessage(value, window.location.origin, event.ports);
});

const bridge: DesktopBridge = Object.freeze({
  connectHost: () => ipcRenderer.send(DesktopChannel.Connect),
  selectFolder: async () => {
    const value: unknown = await ipcRenderer.invoke(DesktopChannel.SelectFolder);
    return typeof value === 'string' ? value : null;
  },
  openExternal: async (value: string) => {
    const url = externalWebUrl(value);
    if (!url || !navigator.userActivation.isActive) return false;
    const opened: unknown = await ipcRenderer.invoke(DesktopChannel.OpenExternal, url);
    return opened === true;
  },
  onHostStatus: (listener: (status: HostStatus) => void) => {
    const receive = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isHostStatus(value)) listener(value);
    };
    ipcRenderer.on(DesktopChannel.Status, receive);
    return () => ipcRenderer.removeListener(DesktopChannel.Status, receive);
  },
});

if (process.isMainFrame) contextBridge.exposeInMainWorld('daziDesktop', bridge);
