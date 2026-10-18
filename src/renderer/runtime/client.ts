import { applyImmutable } from '@earendil-works/chord/delta';
import type { ConversationView } from '@earendil-works/pi-durable';
import { DesktopChannel, HostConnectionState, isHostPortMessage } from '../../shared/rpc/desktop';
import {
  Wire,
  type CommandMap,
  type HostEvent,
  type WorkDocuments,
  type WorkSummary,
} from '../../shared/rpc/protocol';

export type RuntimeSnapshot = {
  connected: boolean;
  generation: number;
  error: string | null;
  works: WorkSummary[];
  workId: string | null;
  view: ConversationView | null;
  documents: WorkDocuments | null;
};
export class RuntimeClient {
  private state: RuntimeSnapshot = {
    connected: false,
    generation: -1,
    error: null,
    works: [],
    workId: null,
    view: null,
    documents: null,
  };
  private listeners = new Set<() => void>();
  private port: MessagePort | null = null;
  private generation = -1;
  private subscriptionId: string | null = null;
  private sequence = -1;
  private desiredWork: string | null = null;
  private pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(change: Partial<RuntimeSnapshot>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((fn) => fn());
  }
  attach(port: MessagePort, generation: number) {
    if (generation <= this.generation) {
      port.close();
      return;
    }
    this.disconnect();
    this.generation = generation;
    this.port = port;
    this.update({ connected: true, generation, error: null, view: null, documents: null });
    port.onmessage = (event: MessageEvent<HostEvent>) => {
      if (this.port === port && generation === this.generation) this.receive(event.data);
    };
    port.onmessageerror = () => {
      if (this.port === port) this.disconnect('Connection interrupted. Reconnect to continue.');
    };
    port.start();
    // Host sends the initial catalog; a competing list RPC could roll it back.
    if (this.desiredWork) void this.openWork(this.desiredWork);
  }
  disconnect(error: string | null = null) {
    this.port?.close();
    this.port = null;
    this.subscriptionId = null;
    this.sequence = -1;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Connection lost before confirmation. Retry with the same request ID.'));
    }
    this.pending.clear();
    this.update({ connected: false, error });
  }
  async openWork(workId: string) {
    this.desiredWork = workId;
    this.subscriptionId = crypto.randomUUID();
    const subscriptionId = this.subscriptionId;
    this.sequence = -1;
    this.update({ workId, view: null, documents: null, error: null });
    if (!this.port) return;
    try {
      await this.request('subscribeWork', { workId, subscriptionId });
    } catch (error) {
      if (this.subscriptionId === subscriptionId)
        this.update({ error: error instanceof Error ? error.message : 'Unable to open work.' });
    }
  }
  request<K extends keyof CommandMap>(
    command: K,
    input: CommandMap[K]['input'],
  ): Promise<CommandMap[K]['output']> {
    const port = this.port;
    if (!port) return Promise.reject(new Error('The desktop host is disconnected.'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Confirmation timed out. The work may still be running.'));
      }, 60_000);
      this.pending.set(id, {
        resolve: (value) => resolve(value as CommandMap[K]['output']),
        reject,
        timer,
      });
      port.postMessage({ type: Wire.Request, id, command, input });
    });
  }
  private receive(event: HostEvent) {
    if (event.type === Wire.Response) {
      const pending = this.pending.get(event.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(event.id);
      if (event.ok) pending.resolve(event.value);
      else pending.reject(new Error(event.error));
    } else if (event.type === Wire.Catalog) {
      this.update({ works: event.works });
      this.port?.postMessage({ type: Wire.NoticeAck, noticeId: event.noticeId });
    } else if (event.type === Wire.Error) this.update({ error: event.error });
    else if (
      event.type === Wire.Snapshot &&
      event.workId === this.desiredWork &&
      event.subscriptionId === this.subscriptionId &&
      event.sequence > this.sequence
    ) {
      this.subscriptionId = event.subscriptionId;
      this.sequence = event.sequence;
      this.update({ view: event.value, workId: event.workId, documents: null, error: null });
      this.ack(event.sequence);
    } else if (
      event.type === Wire.Delta &&
      event.subscriptionId === this.subscriptionId &&
      event.workId === this.desiredWork
    ) {
      if (event.sequence <= this.sequence) {
        this.ack(event.sequence);
        return;
      }
      if (event.sequence !== this.sequence + 1 || !this.state.view) {
        void this.openWork(event.workId);
        return;
      }
      try {
        const view = applyImmutable(this.state.view, event.ops);
        this.sequence = event.sequence;
        this.update({ view });
        this.ack(event.sequence);
      } catch {
        void this.openWork(event.workId);
      }
    } else if (event.type === Wire.Documents) {
      if (event.subscriptionId === this.subscriptionId && event.workId === this.desiredWork)
        this.update({ documents: event.value });
      this.port?.postMessage({ type: Wire.NoticeAck, noticeId: event.noticeId });
    } else if (event.type === Wire.Settlement && event.workId === this.desiredWork) {
      // Settlement is authoritative; an idle transport or cleared live slot is not success.
      this.update({
        error:
          event.value.status === 'unanswered' ? `The run stopped: ${event.value.reason}` : null,
      });
    }
  }
  private ack(sequence: number) {
    this.port?.postMessage({ type: Wire.Ack, subscriptionId: this.subscriptionId, sequence });
  }
}
export const runtimeClient = new RuntimeClient();
export const isDesktop = () => typeof window !== 'undefined' && Boolean(window.daziDesktop);
let started = false;
export function startRuntime() {
  if (started || !window.daziDesktop) return;
  started = true;
  window.addEventListener('message', (event) => {
    if (
      event.source !== window ||
      event.origin !== window.location.origin ||
      !isHostPortMessage(event.data) ||
      event.ports.length !== 1
    )
      return;
    runtimeClient.attach(event.ports[0], event.data.generation);
  });
  window.daziDesktop.onHostStatus((status) => {
    if (status.state !== HostConnectionState.Connected)
      runtimeClient.disconnect(
        status.state === HostConnectionState.Stopped ? 'The desktop host could not restart.' : null,
      );
  });
  window.daziDesktop.connectHost();
}
// Keep the handshake channel explicit; no arbitrary IPC channel is exposed.
export const runtimeHandshake = DesktopChannel.Port;
