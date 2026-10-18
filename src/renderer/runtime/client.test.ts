import { afterEach, describe, expect, it } from 'vitest';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import type { JsonValue } from '@earendil-works/chord';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { RuntimeClient } from './client';
import { Wire, type ClientMessage, type HostEvent } from '../../shared/rpc/protocol';
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
async function setup() {
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: createModels(), registry: createRegistry() },
    BACKGROUND_CONTEXT,
  );
  cleanups.push(() => harness.close(BACKGROUND_CONTEXT));
  const conversation = await harness.root(BACKGROUND_CONTEXT);
  const watch = await conversation.watch(BACKGROUND_CONTEXT);
  const client = new RuntimeClient();
  const pair = new MessageChannel();
  const received: ClientMessage[] = [];
  pair.port2.onmessage = (event: MessageEvent<ClientMessage>) => {
    received.push(event.data);
    if (event.data.type === Wire.Request)
      pair.port2.postMessage({
        type: Wire.Response,
        id: event.data.id,
        ok: true,
        value: event.data.command === 'listWorks' ? [] : {},
      });
  };
  pair.port2.start();
  client.attach(pair.port1, 1);
  cleanups.push(() => {
    client.disconnect();
    pair.port2.close();
  });
  await client.openWork(String(conversation.id));
  await tick();
  const request = received
    .filter((item) => item.type === Wire.Request && item.command === 'subscribeWork')
    .at(-1);
  if (!request || request.type !== Wire.Request || request.command !== 'subscribeWork')
    throw new Error('Missing subscription');
  const send = (event: HostEvent) => pair.port2.postMessage(event);
  const base = { workId: String(conversation.id), subscriptionId: request.input.subscriptionId };
  return { client, pair, received, send, base, value: watch.value };
}
describe('native stream transport', () => {
  it('applies root replacement and acknowledges only committed sequence without duplicate append', async () => {
    const { client, received, send, base, value } = await setup();
    send({ type: Wire.Snapshot, ...base, sequence: 0, value });
    await tick();
    const replacement = { ...value, docs: {} };
    send({
      type: Wire.Delta,
      ...base,
      sequence: 1,
      ops: [['r', JSON.parse(JSON.stringify(replacement)) as JsonValue]],
    });
    await tick();
    send({
      type: Wire.Delta,
      ...base,
      sequence: 1,
      ops: [['r', JSON.parse(JSON.stringify(value)) as JsonValue]],
    });
    await tick();
    expect(client.getSnapshot().view).toEqual(replacement);
    expect(received.filter((item) => item.type === Wire.Ack).length).toBe(3);
  });
  it('rejects stale same-work snapshots after a new subscription and starts fresh on sequence gaps', async () => {
    const { client, received, send, base, value } = await setup();
    await client.openWork(base.workId);
    await tick();
    send({ type: Wire.Snapshot, ...base, sequence: 0, value });
    await tick();
    expect(client.getSnapshot().view).toBeNull();
    const req = received
      .filter((item) => item.type === Wire.Request && item.command === 'subscribeWork')
      .at(-1);
    if (!req || req.type !== Wire.Request || req.command !== 'subscribeWork')
      throw new Error('Missing subscription');
    send({
      type: Wire.Snapshot,
      ...base,
      subscriptionId: req.input.subscriptionId,
      sequence: 0,
      value,
    });
    await tick();
    send({
      type: Wire.Delta,
      ...base,
      subscriptionId: req.input.subscriptionId,
      sequence: 3,
      ops: [],
    });
    await tick();
    expect(client.getSnapshot().view).toBeNull();
    expect(
      received.filter((item) => item.type === Wire.Request && item.command === 'subscribeWork'),
    ).toHaveLength(3);
  });
  it('rejects an old connection generation and clears uncertain RPCs on disconnect', async () => {
    const { client, pair, value, base, send } = await setup();
    send({ type: Wire.Snapshot, ...base, sequence: 0, value });
    await tick();
    const stale = new MessageChannel();
    client.attach(stale.port1, 1);
    stale.port2.close();
    expect(client.getSnapshot().connected).toBe(true);
    pair.port2.onmessage = null;
    const pending = client.request('abort', { workId: base.workId });
    client.disconnect();
    await expect(pending).rejects.toThrow('Connection lost');
    expect(client.getSnapshot().connected).toBe(false);
  });
});
