/** The complete, deliberately small renderer ↔ desktop surface. */
export const DesktopChannel = {
  Connect: 'dazi:connect-host',
  Port: 'dazi:host-port',
  Status: 'dazi:host-status',
  SelectFolder: 'dazi:select-folder',
  OpenExternal: 'dazi:open-external',
} as const;

export const HostControl = {
  Ready: 'dazi:ready',
  Connect: 'dazi:connect',
  Shutdown: 'dazi:shutdown',
} as const;

export const HostConnectionState = {
  Starting: 'starting',
  Connected: 'connected',
  Restarting: 'restarting',
  Stopped: 'stopped',
} as const;
export type HostConnectionState = (typeof HostConnectionState)[keyof typeof HostConnectionState];

export interface HostStatus {
  state: HostConnectionState;
  generation: number;
  retryInMs?: number;
}

export interface HostPortMessage {
  type: typeof DesktopChannel.Port;
  generation: number;
}

export interface DesktopBridge {
  /** Install the window message listener before requesting this handshake. */
  connectHost(): void;
  selectFolder(): Promise<string | null>;
  /** Only an explicit user interaction may open a validated web link. */
  openExternal(url: string): Promise<boolean>;
  onHostStatus(listener: (status: HostStatus) => void): () => void;
}

export function externalWebUrl(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    value.trim() !== value ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return null;
  try {
    const url = new URL(value);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export function isHostPortMessage(value: unknown): value is HostPortMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === DesktopChannel.Port &&
    'generation' in value &&
    Number.isSafeInteger(value.generation) &&
    Number(value.generation) > 0
  );
}

export function isHostStatus(value: unknown): value is HostStatus {
  return (
    typeof value === 'object' &&
    value !== null &&
    'state' in value &&
    Object.values(HostConnectionState).some((state) => state === value.state) &&
    'generation' in value &&
    Number.isSafeInteger(value.generation) &&
    Number(value.generation) >= 0 &&
    (!('retryInMs' in value) ||
      (typeof value.retryInMs === 'number' &&
        Number.isFinite(value.retryInMs) &&
        value.retryInMs >= 0))
  );
}

declare global {
  interface Window {
    daziDesktop?: DesktopBridge;
  }
}
