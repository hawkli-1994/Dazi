import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiveDoc, MemoryStorage, type ConversationId } from '@earendil-works/pi-durable';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command, Wire } from '../shared/rpc/protocol';
import { WorkDoc } from './documents';
import { context, HostRuntime } from './runtime';
import { parseClientMessage } from './transport';

let runtime: HostRuntime;
let path: string;
beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network in admission tests.'));
  path = await mkdtemp(join(tmpdir(), 'dazi-admission-'));
  runtime = await HostRuntime.open({ storage: new MemoryStorage(), testProvider: true });
});
afterEach(async () => {
  await runtime.close();
  await rm(path, { recursive: true, force: true });
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

async function pausedConversation() {
  const { workId } = await runtime.createWork({
    goal: 'Archive race',
    directory: path,
    requestId: 'create',
  });
  const original = runtime.conversation.bind(runtime);
  let entered!: () => void;
  const paused = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let resume!: () => void;
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  vi.spyOn(runtime, 'conversation').mockImplementationOnce(async (...args) => {
    const conversation = await original(...args);
    entered();
    await gate;
    return conversation;
  });
  return { workId, paused, resume };
}
function archive(workId: string) {
  return runtime.handle({
    type: Wire.Request,
    id: 'archive',
    command: Command.Archive,
    input: { workId },
  });
}
async function expectArchivedIdle(workId: string) {
  const id = Number(workId) as ConversationId;
  expect((await runtime.harness.snapshot(WorkDoc, id, context))?.archived).toBe(true);
  expect((await runtime.harness.snapshot(LiveDoc, id, context))?.run).toBeUndefined();
}

describe('atomic ordering of archive and native admission', () => {
  it('rejects alternate numeric spellings at the runtime and transport boundaries', async () => {
    const { workId } = await runtime.createWork({
      goal: 'Canonical ID',
      directory: path,
      requestId: 'canonical',
    });
    for (const alias of [
      `0${workId}`,
      `+${workId}`,
      `${workId}.0`,
      ` ${workId}`,
      '0',
      '9007199254740992',
    ]) {
      await expect(
        runtime.submit({ workId: alias, text: 'Late input', requestId: alias }),
      ).rejects.toThrow('WORK_NOT_FOUND');
      await expect(archive(alias)).rejects.toThrow('WORK_NOT_FOUND');
      expect(() =>
        parseClientMessage({
          type: Wire.Request,
          id: 'invalid',
          command: Command.Abort,
          input: { workId: alias },
        }),
      ).toThrow('INVALID_INPUT');
    }
    expect((await runtime.documents(workId)).work.archived).toBe(false);
    expect((await runtime.harness.inspect(context)).submissions).toEqual([]);
  });
  it('does not let archive finish between a submit archive check and its admission', async () => {
    const { workId, paused, resume } = await pausedConversation();
    const submit = runtime.submit({
      workId,
      text: '[test:slow] pending input',
      requestId: 'submit',
    });
    await paused;
    let archived = false;
    const archiving = archive(workId).then(() => {
      archived = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(archived).toBe(false);
    resume();
    await Promise.all([submit, archiving]);
    await expectArchivedIdle(workId);
    await expect(runtime.submit({ workId, text: 'Late input', requestId: 'late' })).rejects.toThrow(
      'WORK_ARCHIVED',
    );
  });

  it('rejects a submit queued behind an archive without holding the gate during abort', async () => {
    const { workId, paused, resume } = await pausedConversation();
    const archiving = archive(workId);
    await paused;
    const submitting = runtime.submit({ workId, text: 'Late input', requestId: 'late' });
    const rejected = expect(submitting).rejects.toThrow('WORK_ARCHIVED');
    resume();
    await Promise.all([archiving, rejected]);
    await expectArchivedIdle(workId);
    expect((await runtime.harness.inspect(context)).submissions).toEqual([]);
  });
});
