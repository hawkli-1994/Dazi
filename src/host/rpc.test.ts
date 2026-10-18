import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyImmutable } from '@earendil-works/chord/delta';
import { MemoryStorage, type ConversationView } from '@earendil-works/pi-durable';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command, Wire, type HostEvent } from '../shared/rpc/protocol';
import { DossierDoc } from './documents';
import { HostConnection } from './rpc';
import { context, HostRuntime } from './runtime';
import { parseClientMessage } from './transport';

let runtime: HostRuntime;
let connection: HostConnection;
let path: string;
let frames: HostEvent[];
let autoAck: boolean;
let autoNoticeAck: boolean;

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network in Host tests.'));
  path = await mkdtemp(join(tmpdir(), 'dazi-rpc-'));
  runtime = await HostRuntime.open({ storage: new MemoryStorage(), testProvider: true });
  frames = [];
  autoAck = true;
  autoNoticeAck = true;
  connection = new HostConnection(runtime, (event) => {
    frames.push(structuredClone(event));
    if (autoNoticeAck && (event.type === Wire.Catalog || event.type === Wire.Documents)) {
      void connection.receive({ type: Wire.NoticeAck, noticeId: event.noticeId });
    }
    if (autoAck && (event.type === Wire.Snapshot || event.type === Wire.Delta)) {
      void connection.receive({
        type: Wire.Ack,
        subscriptionId: event.subscriptionId,
        sequence: event.sequence,
      });
    }
  });
});
afterEach(async () => {
  await connection.close();
  await runtime.close();
  await rm(path, { recursive: true, force: true });
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

async function create() {
  return (await runtime.createWork({ goal: 'RPC test', directory: path, requestId: randomUUID() }))
    .workId;
}
async function subscribe(workId: string, subscriptionId = randomUUID()) {
  await connection.receive({
    type: Wire.Request,
    id: randomUUID(),
    command: Command.SubscribeWork,
    input: { workId, subscriptionId },
  });
  return subscriptionId;
}

describe('native MessagePort protocol', () => {
  it('bounds catalog and document notifications to one unacknowledged frame each', async () => {
    const workId = await create();
    // Drain the initial catalog, then hold subsequent notice delivery independently of native ACK.
    await vi.waitFor(() =>
      expect(frames.some((event) => event.type === Wire.Catalog && event.works.length === 1)).toBe(
        true,
      ),
    );
    autoNoticeAck = false;
    frames = [];
    await subscribe(workId);
    const conversation = await runtime.conversation(workId);
    for (let index = 0; index < 30; index++) {
      await conversation.commit(async (tx) => {
        (await tx.doc(DossierDoc, conversation.id)).notes = [
          { id: 'latest', text: String(index), sourceEntryId: '' },
        ];
      }, context);
    }
    await vi.waitFor(() =>
      expect(frames.filter((event) => event.type === Wire.Catalog)).toHaveLength(1),
    );
    expect(frames.filter((event) => event.type === Wire.Documents)).toHaveLength(1);
    const held = frames.filter(
      (event) => event.type === Wire.Catalog || event.type === Wire.Documents,
    );
    autoNoticeAck = true;
    for (const event of held)
      await connection.receive({ type: Wire.NoticeAck, noticeId: event.noticeId });
    await vi.waitFor(() => {
      expect(
        frames.some(
          (event) => event.type === Wire.Documents && event.value.dossier.notes[0]?.text === '29',
        ),
      ).toBe(true);
      expect(
        frames.some(
          (event) =>
            event.type === Wire.Catalog &&
            event.works[0]?.documents?.dossier.notes[0]?.text === '29',
        ),
      ).toBe(true);
    });
    expect(frames.filter((event) => event.type === Wire.Documents)).toHaveLength(2);
    expect(frames.filter((event) => event.type === Wire.Catalog)).toHaveLength(2);
  });
  it('sends the client-owned snapshot epoch and documents before changes', async () => {
    const workId = await create();
    const id = await subscribe(workId);
    const stream = frames.filter(
      (event) =>
        event.type === Wire.Snapshot || event.type === Wire.Documents || event.type === Wire.Delta,
    );
    expect(stream[0]).toMatchObject({
      type: Wire.Snapshot,
      subscriptionId: id,
      workId,
      sequence: 0,
    });
    expect(stream[1]).toMatchObject({ type: Wire.Documents, subscriptionId: id, workId });
    const conversation = await runtime.conversation(workId);
    await conversation.commit(async (tx) => {
      (await tx.doc(DossierDoc, conversation.id)).notes.push({
        id: 'fact',
        text: 'Confirmed context',
        sourceEntryId: '',
      });
    }, context);
    await vi.waitFor(() =>
      expect(
        frames.some(
          (event) => event.type === Wire.Documents && event.value.dossier.notes.length === 1,
        ),
      ).toBe(true),
    );
    await vi.waitFor(() =>
      expect(
        frames.some(
          (event) =>
            event.type === Wire.Catalog && event.works[0]?.documents?.dossier.notes.length === 1,
        ),
      ).toBe(true),
    );
    expect(frames.filter((event) => event.type === Wire.Error)).toEqual([]);
  });

  it('holds native delivery for ACK and coalesces a slow client without changing Op tuples', async () => {
    const workId = await create();
    autoAck = false;
    const id = await subscribe(workId);
    const conversation = await runtime.conversation(workId);
    for (let index = 0; index < 135; index++) {
      await conversation.commit(async (tx) => {
        await tx.appendEntry(conversation.id, { kind: 'dazi.test', data: { index } });
      }, context);
    }
    expect(frames.filter((event) => event.type === Wire.Delta)).toHaveLength(0);
    await connection.receive({ type: Wire.Ack, subscriptionId: randomUUID(), sequence: 0 });
    expect(frames.filter((event) => event.type === Wire.Delta)).toHaveLength(0);
    autoAck = true;
    await connection.receive({ type: Wire.Ack, subscriptionId: id, sequence: 0 });
    const native = await conversation.viewState(context);
    try {
      await vi.waitFor(() => {
        let value: ConversationView | undefined;
        const sequences: number[] = [];
        for (const event of frames) {
          if (event.type === Wire.Snapshot) {
            value = event.value;
            sequences.push(event.sequence);
          }
          if (event.type === Wire.Delta && value) {
            value = applyImmutable(value, event.ops);
            sequences.push(event.sequence);
          }
        }
        expect(value).toEqual(native.value);
        expect(sequences).toEqual(sequences.map((_sequence, index) => index));
      });
      expect(
        frames.some((event) => event.type === Wire.Delta && event.ops.some((op) => op[0] === 'r')),
      ).toBe(true);
      expect(frames.filter((event) => event.type === Wire.Delta).length).toBeLessThan(100);
    } finally {
      native.dispose();
    }
  });

  it('discards overlapping A-B-A acquisitions and stops old document/native watchers', async () => {
    const a = await create();
    const b = await create();
    const old = await subscribe(a);
    frames = [];
    const bId = randomUUID();
    const newA = randomUUID();
    await Promise.all([subscribe(b, bId), subscribe(a, newA)]);
    const conversation = await runtime.conversation(a);
    await conversation.commit(async (tx) => {
      await tx.appendEntry(conversation.id, { kind: 'dazi.test', data: {} });
    }, context);
    await vi.waitFor(() =>
      expect(
        frames.some((event) => event.type === Wire.Delta && event.subscriptionId === newA),
      ).toBe(true),
    );
    expect(
      frames
        .filter((event) => 'subscriptionId' in event)
        .every((event) => event.subscriptionId === newA),
    ).toBe(true);
    await connection.receive({ type: Wire.Ack, subscriptionId: old, sequence: 1 });
    expect(frames.filter((event) => event.type === Wire.Error)).toEqual([]);
  });

  it('disconnects without aborting admitted work and reconnects with one fresh snapshot', async () => {
    const workId = await create();
    await subscribe(workId);
    await runtime.submit({ workId, text: 'A local test', requestId: randomUUID() });
    await connection.close();
    await (await runtime.conversation(workId)).waitForIdle(context);
    expect((await runtime.listWorks())[0].settlement).toMatchObject({ status: 'done' });
    frames = [];
    connection = new HostConnection(runtime, (event) => {
      frames.push(event);
    });
    await subscribe(workId);
    expect(frames.filter((event) => event.type === Wire.Snapshot)).toHaveLength(1);
    expect(frames.filter((event) => event.type === Wire.Delta)).toHaveLength(0);
  });

  it('rejects malformed commands and invalid subscription IDs without raw exceptions', async () => {
    for (const value of [
      null,
      [],
      {
        type: Wire.Request,
        id: 'bad',
        command: Command.SetSchedule,
        input: { workId: '1', schedule: null },
      },
      {
        type: Wire.Request,
        id: 'bad',
        command: Command.SubscribeWork,
        input: { workId: '1', subscriptionId: 'not-a-uuid' },
      },
    ]) {
      expect(() => parseClientMessage(value)).toThrow('INVALID_INPUT');
      await connection.receive(value);
    }
    expect(frames.filter((event) => event.type === Wire.Error)).toHaveLength(4);
  });
});
