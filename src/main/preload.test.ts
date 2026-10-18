import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopChannel, HostConnectionState } from '../shared/rpc/desktop';

const mocks = vi.hoisted(() => {
  const mocks = {
    expose: vi.fn(),
    send: vi.fn(),
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    postMessage: vi.fn(),
  };
  vi.stubGlobal('window', { location: { origin: 'dazi://app' }, postMessage: mocks.postMessage });
  vi.stubGlobal('navigator', { userActivation: { isActive: true } });
  Object.defineProperty(process, 'isMainFrame', { configurable: true, value: true });
  Object.defineProperty(process, 'contextIsolated', { configurable: true, value: true });
  Object.defineProperty(process, 'sandboxed', { configurable: true, value: true });
  return mocks;
});

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.expose },
  ipcRenderer: {
    on: mocks.on,
    send: mocks.send,
    invoke: mocks.invoke,
    removeListener: mocks.removeListener,
  },
}));

// The preload is exercised without an Electron process; the actual sandbox and
// isolation are verified by the separate Electron/Xvfb integration suite.
import './preload';

describe('minimal preload bridge', () => {
  const bridge = mocks.expose.mock.calls[0][1];
  const portListener = mocks.on.mock.calls.find((call) => call[0] === DesktopChannel.Port)?.[1];

  beforeEach(() => {
    mocks.send.mockClear();
    mocks.invoke.mockReset();
    mocks.postMessage.mockClear();
  });

  it('exposes only fixed system actions, never raw IPC', async () => {
    expect(mocks.expose.mock.calls[0][0]).toBe('daziDesktop');
    expect(Object.keys(bridge).sort()).toEqual([
      'connectHost',
      'onHostStatus',
      'openExternal',
      'selectFolder',
    ]);
    bridge.connectHost();
    expect(mocks.send).toHaveBeenCalledWith(DesktopChannel.Connect);
    mocks.invoke
      .mockResolvedValueOnce('/chosen/work')
      .mockResolvedValueOnce({ path: '/untrusted' });
    expect(await bridge.selectFolder()).toBe('/chosen/work');
    expect(await bridge.selectFolder()).toBeNull();
    expect(mocks.invoke).toHaveBeenCalledWith(DesktopChannel.SelectFolder);
  });

  it('requires user activation and rejects unsafe external links before IPC', async () => {
    mocks.invoke.mockResolvedValue(true);
    expect(await bridge.openExternal('https://example.com/review')).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      DesktopChannel.OpenExternal,
      'https://example.com/review',
    );
    for (const url of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,test',
      'https://user:secret@example.com',
    ]) {
      expect(await bridge.openExternal(url)).toBe(false);
    }
    vi.stubGlobal('navigator', { userActivation: { isActive: false } });
    expect(await bridge.openExternal('https://example.com')).toBe(false);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    vi.stubGlobal('navigator', { userActivation: { isActive: true } });
  });

  it('forwards only a validated port to its own exact origin', () => {
    const port = { close: vi.fn() };
    portListener({ ports: [port] }, { type: DesktopChannel.Port, generation: 1 });
    expect(mocks.postMessage).toHaveBeenCalledWith(
      { type: DesktopChannel.Port, generation: 1 },
      'dazi://app',
      [port],
    );
    portListener({ ports: [port] }, { type: DesktopChannel.Port, generation: -1 });
    expect(port.close).toHaveBeenCalledOnce();
    expect(mocks.postMessage).toHaveBeenCalledTimes(1);
  });

  it('strips Electron event objects from status listeners and supports cleanup', () => {
    const listener = vi.fn();
    const dispose = bridge.onHostStatus(listener);
    const receive = mocks.on.mock.calls.at(-1)?.[1];
    const status = { state: HostConnectionState.Connected, generation: 1 };
    receive({ sender: 'must never escape' }, status);
    receive({ sender: 'must never escape' }, { state: 'arbitrary', generation: 1 });
    expect(listener).toHaveBeenCalledExactlyOnceWith(status);
    dispose();
    expect(mocks.removeListener).toHaveBeenCalledWith(DesktopChannel.Status, receive);
  });
});
