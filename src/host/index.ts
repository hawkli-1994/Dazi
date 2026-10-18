import type { MessagePortMain } from 'electron';
import { HostControl } from '../shared/rpc/desktop';
import { HostConnection } from './rpc';
import { HostRuntime } from './runtime';
import { WorkScheduler } from './scheduler';

async function main(): Promise<void> {
  const storageIndex = process.argv.indexOf('--storage-path');
  const runtime = await HostRuntime.open({
    storagePath: storageIndex >= 0 ? process.argv[storageIndex + 1] : undefined,
    testProvider: process.argv.includes('--test-provider'),
  });
  const scheduler = new WorkScheduler(runtime);
  scheduler.start();
  let current: { port: MessagePortMain; connection: HostConnection } | undefined;
  let generation = 0;
  let shuttingDown = false;

  const disconnect = async () => {
    const previous = current;
    current = undefined;
    if (!previous) return;
    previous.port.close();
    await previous.connection.close();
  };
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await disconnect();
    await scheduler.close();
    // Close preserves pending native tasks/approvals. It must not call abort.
    await runtime.close();
    process.exit(0);
  };
  process.parentPort.on('message', (event) => {
    const data: unknown = event.data;
    if (!data || typeof data !== 'object' || !('type' in data)) return;
    if (data.type === HostControl.Shutdown) {
      void shutdown().catch(() => process.exit(1));
      return;
    }
    if (
      shuttingDown ||
      data.type !== HostControl.Connect ||
      !('generation' in data) ||
      !Number.isSafeInteger(data.generation) ||
      Number(data.generation) <= generation
    ) {
      for (const port of event.ports) port.close();
      return;
    }
    const port = event.ports[0];
    if (!port) return;
    generation = Number(data.generation);
    const connectGeneration = generation;
    void disconnect()
      .then(() => {
        if (shuttingDown || connectGeneration !== generation) {
          port.close();
          return;
        }
        const connection = new HostConnection(runtime, (message) => port.postMessage(message));
        current = { port, connection };
        port.on('message', (message) => {
          void connection.receive(message.data);
        });
        port.on('close', () => {
          if (current?.port === port) current = undefined;
          void connection.close();
        });
        port.start();
      })
      .catch(() => {
        port.close();
      });
  });
  process.once('SIGTERM', () => {
    void shutdown().catch(() => process.exit(1));
  });
  process.once('SIGINT', () => {
    void shutdown().catch(() => process.exit(1));
  });
  void runtime.harness.closed.then((end) => {
    if (end.reason === 'failed') {
      console.error('[Host] Durable storage failed; a clean restart is required.');
      process.exit(1);
    }
  });
  process.parentPort.postMessage({ type: HostControl.Ready });
}

void main().catch(() => {
  console.error('[Host] The agent runtime could not start.');
  process.exit(1);
});
