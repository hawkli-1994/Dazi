import type { MessagePortMain } from 'electron';
import { HostConnectionState, HostControl, type HostStatus } from '../shared/rpc/desktop';

export interface HostProcess {
  on(event: 'message', listener: (message: unknown) => void): unknown;
  once(event: 'exit', listener: (code: number) => void): unknown;
  postMessage(message: unknown, transfer?: MessagePortMain[]): void;
  kill(): boolean;
}

interface SupervisorOptions {
  spawn(): HostProcess;
  connect(child: HostProcess, generation: number): boolean;
  status(status: HostStatus): void;
  restartBaseMs?: number;
  restartMaxMs?: number;
  readyTimeoutMs?: number;
  stableAfterMs?: number;
}

/** Supervises lifecycle only. Model/tool traffic never passes through Main. */
export class HostSupervisor {
  private child: HostProcess | null = null;
  private ready = false;
  private requested = false;
  private attached = false;
  private stopping = false;
  private generation = 0;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readyTimer: ReturnType<typeof setTimeout> | undefined;
  private stableTimer: ReturnType<typeof setTimeout> | undefined;
  private current: HostStatus = { state: HostConnectionState.Starting, generation: 0 };

  constructor(private readonly options: SupervisorOptions) {}

  start(): void {
    if (this.child || this.timer || this.stopping) return;
    this.publish(HostConnectionState.Starting);
    let child: HostProcess;
    try {
      child = this.options.spawn();
    } catch {
      this.scheduleRestart();
      return;
    }
    this.child = child;
    this.ready = false;
    this.attached = false;
    this.readyTimer = setTimeout(() => child.kill(), this.options.readyTimeoutMs ?? 30_000);
    child.on('message', (message) => {
      if (
        this.child !== child ||
        this.stopping ||
        this.ready ||
        typeof message !== 'object' ||
        message === null ||
        !('type' in message) ||
        message.type !== HostControl.Ready
      ) {
        return;
      }
      this.ready = true;
      clearTimeout(this.readyTimer);
      this.stableTimer = setTimeout(() => {
        this.failures = 0;
      }, this.options.stableAfterMs ?? 30_000);
      this.connectIfRequested();
    });
    child.once('exit', () => {
      if (this.child !== child) return;
      clearTimeout(this.readyTimer);
      clearTimeout(this.stableTimer);
      this.child = null;
      this.ready = false;
      this.attached = false;
      if (!this.stopping) this.scheduleRestart();
    });
  }

  requestConnection(): void {
    if (this.stopping) return;
    this.requested = true;
    this.attached = false;
    this.options.status(this.current);
    this.connectIfRequested();
  }

  /** Call on navigation/destruction so no port is sent to a previous document. */
  detachRenderer(): void {
    this.requested = false;
    this.attached = false;
  }

  async shutdown(timeoutMs = 5_000): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    clearTimeout(this.timer);
    clearTimeout(this.readyTimer);
    clearTimeout(this.stableTimer);
    this.publish(HostConnectionState.Stopped);
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill();
        resolve();
      }, timeoutMs);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      try {
        child.postMessage({ type: HostControl.Shutdown });
      } catch {
        clearTimeout(timeout);
        child.kill();
        resolve();
      }
    });
  }

  private connectIfRequested(): void {
    if (!this.requested || !this.ready || this.attached || !this.child) return;
    const generation = this.generation + 1;
    if (this.options.connect(this.child, generation)) {
      this.generation = generation;
      this.attached = true;
      this.publish(HostConnectionState.Connected);
    }
  }

  private scheduleRestart(): void {
    if (this.stopping) return;
    const delay = Math.min(
      (this.options.restartBaseMs ?? 500) * 2 ** Math.min(this.failures++, 20),
      this.options.restartMaxMs ?? 30_000,
    );
    this.publish(HostConnectionState.Restarting, delay);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.start();
    }, delay);
  }

  private publish(state: HostStatus['state'], retryInMs?: number): void {
    this.current = {
      state,
      generation: this.generation,
      ...(retryInMs === undefined ? {} : { retryInMs }),
    };
    this.options.status(this.current);
  }
}
