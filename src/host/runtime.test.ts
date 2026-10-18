import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { applyImmutable, type Op } from '@earendil-works/chord/delta';
import {
  AgentDoc,
  AssistantEntry,
  LiveDoc,
  MemoryStorage,
  ToolResultEntry,
  UserEntry,
  type ConversationView,
  type LiveState,
  type SubmissionId,
  type SubmissionSettlement,
} from '@earendil-works/pi-durable';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command, Wire } from '../shared/rpc/protocol';
import { SettingsDoc } from './documents';
import { HostErrorCode } from './errors';
import { HostRuntime, context, type RuntimeOptions } from './runtime';
import { TestToolName } from './testing';

const directories: string[] = [];
const runtimes: HostRuntime[] = [];

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(
    new Error('Network calls are forbidden in runtime tests.'),
  );
});

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'dazi-runtime-'));
  directories.push(path);
  return path;
}

async function open(
  options: RuntimeOptions = { storage: new MemoryStorage(), testProvider: true },
) {
  const runtime = await HostRuntime.open(options);
  runtimes.push(runtime);
  return runtime;
}

async function createWork(runtime: HostRuntime, path = '', requestId = 'create-work') {
  return runtime.createWork({
    goal: 'Finish the local runtime check',
    directory: path || (await directory()),
    requestId,
  });
}

async function submission(runtime: HostRuntime, id: string) {
  const result = await runtime.harness.submission(Number(id) as SubmissionId, context);
  if (!result) throw new Error('Submission was not durably admitted.');
  return result;
}

async function entries(runtime: HostRuntime, workId: string) {
  return (
    await (
      await runtime.conversation(workId)
    ).entries({ order: 'ascending' }, 100, undefined, context)
  ).items;
}

function live(view: ConversationView): LiveState {
  // ConversationView exposes document mounts as JsonObject; the token supplies this schema.
  return view.docs[LiveDoc.definition.kind] as LiveState;
}

describe('HostRuntime work admission', () => {
  it('validates directories before creating work and canonicalizes a selected symlink', async () => {
    const runtime = await open();
    const path = await directory();
    const file = join(path, 'file.txt');
    await writeFile(file, 'fixture');
    for (const candidate of ['relative/path', join(path, 'missing'), file]) {
      await expect(
        runtime.createWork({
          goal: 'Check a directory',
          directory: candidate,
          requestId: candidate,
        }),
      ).rejects.toThrow(HostErrorCode.DirectoryInvalid);
    }
    expect(await runtime.listWorks()).toEqual([]);
    const link = join(await directory(), 'selected-directory');
    await symlink(path, link, 'dir');
    const { workId } = await createWork(runtime, link);
    expect((await runtime.documents(workId)).work.directory).toBe(await realpath(path));
  });

  it('creates one work and all business documents for a repeated request ID', async () => {
    const runtime = await open();
    const path = await directory();
    const input = {
      goal: 'Review the launch\nKeep its context together',
      directory: path,
      requestId: 'same-create',
    };
    const [first, duplicate] = await Promise.all([
      runtime.createWork(input),
      runtime.createWork(input),
    ]);
    expect(duplicate).toEqual(first);
    expect(await runtime.createWork(input)).toEqual(first);
    expect(await runtime.listWorks()).toHaveLength(1);
    const documents = await runtime.documents(first.workId);
    expect(documents).toMatchObject({
      work: {
        title: 'Review the launch',
        goal: input.goal,
        directory: await realpath(path),
        archived: false,
      },
      dossier: { notes: [] },
      plan: { items: [] },
      artifacts: { items: [] },
      decisions: { items: [] },
      schedule: { enabled: false, frequency: 'daily', time: '09:00', prompt: '', lastSlot: '' },
    });
    expect(Number.isNaN(Date.parse(documents.work.createdAt))).toBe(false);
    const conversation = await runtime.conversation(first.workId);
    expect(await runtime.harness.snapshot(AgentDoc, conversation.id, context)).toMatchObject({
      cwd: await realpath(path),
    });
    documents.work.title = 'Client-side mutation';
    expect((await runtime.documents(first.workId)).work.title).toBe('Review the launch');
  });

  it('has no production default and rejects submit before model or credential lookup', async () => {
    const runtime = await open({ storage: new MemoryStorage() });
    const { workId } = await createWork(runtime);
    expect((await runtime.harness.snapshot(SettingsDoc, context))?.selectedModel).toBeNull();
    const auth = vi
      .spyOn(runtime.models, 'checkAuth')
      .mockRejectedValue(new Error('Credentials must not be accessed.'));
    const model = vi.spyOn(runtime.models, 'getModel').mockImplementation(() => {
      throw new Error('No model should be looked up.');
    });
    await expect(
      runtime.submit({ workId, text: 'Do this task', requestId: 'no-model' }),
    ).rejects.toThrow(HostErrorCode.ModelMissing);
    expect(auth).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
    expect((await entries(runtime, workId)).filter((entry) => UserEntry.is(entry))).toHaveLength(0);
    expect((await runtime.harness.inspect(context)).submissions).toHaveLength(0);
  });
});

describe('HostRuntime native observation and cancellation', () => {
  it('reconstructs every watch frame with Chord and exposes real partial/terminal reasoning, text and tool output', async () => {
    const runtime = await open();
    const { workId } = await createWork(runtime);
    const conversation = await runtime.conversation(workId);
    const watch = await conversation.watch(context);
    let reconstructed = structuredClone(watch.value);
    const frames: ConversationView[] = [];
    const batches: (readonly Op[])[] = [];
    const mismatches: ConversationView[] = [];
    watch.start(async (value, ops) => {
      reconstructed = applyImmutable(reconstructed, ops);
      if (!isDeepStrictEqual(reconstructed, value)) mismatches.push(value);
      frames.push(value);
      batches.push(ops);
    });
    const settlements: SubmissionSettlement[] = [];
    runtime.onSettlement((reportedWork, _id, settled) => {
      expect(reportedWork).toBe(workId);
      settlements.push(settled);
    });
    try {
      const input = {
        workId,
        text: '[test:tool] Exercise native progress',
        requestId: 'native-stream',
      };
      const admitted = await runtime.submit(input);
      expect(await runtime.submit(input)).toEqual(admitted);
      expect(await (await submission(runtime, admitted.submissionId)).wait(context)).toMatchObject({
        status: 'done',
        type: 'input',
      });
      await vi.waitFor(() =>
        expect(settlements).toEqual([expect.objectContaining({ status: 'done' })]),
      );
      await vi.waitFor(() => expect(live(watch.value).run).toBeUndefined());
      expect(mismatches).toEqual([]);
      expect(batches.some((ops) => ops.some(([kind]) => kind !== 'r'))).toBe(true);
      expect(
        frames.some((frame) =>
          live(frame).generation?.message?.content.some((block) => block.type === 'thinking'),
        ),
      ).toBe(true);
      expect(
        frames.some((frame) =>
          live(frame).generation?.message?.content.some(
            (block) => block.type === 'text' && block.text.length > 0,
          ),
        ),
      ).toBe(true);
      expect(
        frames.some((frame) =>
          live(frame).tools?.some(
            (tool) =>
              tool.name === TestToolName &&
              tool.status === 'running' &&
              tool.output?.includes('test output'),
          ),
        ),
      ).toBe(true);
      const terminal = await entries(runtime, workId);
      expect(terminal.filter((entry) => UserEntry.is(entry))).toHaveLength(1);
      expect(
        terminal
          .filter((entry) => AssistantEntry.is(entry))
          .some((entry) =>
            entry.model?.some(
              (message) =>
                message.role === 'assistant' &&
                message.content.some((block) => block.type === 'thinking'),
            ),
          ),
      ).toBe(true);
      const tool = terminal.find((entry) => ToolResultEntry.is(entry));
      expect(tool?.model?.[0]).toMatchObject({
        role: 'toolResult',
        toolName: TestToolName,
        isError: false,
        details: { step: 3 },
        content: [{ type: 'text', text: 'test output 1\ntest output 2\ntest output 3\n' }],
      });
      expect(live(watch.value).run).toBeUndefined();
      expect(reconstructed).toEqual(watch.value);
    } finally {
      await watch.stop();
    }
  }, 15_000);

  it('aborts a slow admitted submission and keeps its repeated request ID idempotent', async () => {
    const runtime = await open();
    const { workId } = await createWork(runtime);
    const conversation = await runtime.conversation(workId);
    const input = { workId, text: '[test:slow] Keep streaming', requestId: 'abort-once' };
    const admitted = await runtime.submit(input);
    expect(await runtime.submit(input)).toEqual(admitted);
    await vi.waitFor(async () => {
      expect(
        (await runtime.harness.snapshot(LiveDoc, conversation.id, context))?.generation?.message,
      ).toBeDefined();
    });
    await runtime.handle({
      type: Wire.Request,
      id: 'abort-command',
      command: Command.Abort,
      input: { workId },
    });
    expect(await (await submission(runtime, admitted.submissionId)).wait(context)).toMatchObject({
      status: 'unanswered',
    });
    expect(await runtime.submit(input)).toEqual(admitted);
    expect((await entries(runtime, workId)).filter((entry) => UserEntry.is(entry))).toHaveLength(1);
    expect(
      (await runtime.harness.snapshot(LiveDoc, conversation.id, context))?.run,
    ).toBeUndefined();
  });
});

describe('HostRuntime SQLite recovery', () => {
  it('reopens and settles one pending slow submission without duplicate admission', async () => {
    const path = await directory();
    const storagePath = join(path, 'runtime.sqlite');
    const first = await open({ storagePath, testProvider: true });
    const { workId } = await createWork(first, path, 'durable-work');
    const input = {
      workId,
      text: '[test:slow] Continue after restart',
      requestId: 'durable-input',
    };
    const admitted = await first.submit(input);
    const before = await first.conversation(workId);
    await vi.waitFor(async () => {
      expect(
        (await first.harness.snapshot(LiveDoc, before.id, context))?.generation?.message,
      ).toBeDefined();
    });
    await first.close();
    const second = await open({ storagePath, testProvider: true });
    expect(await createWork(second, path, 'durable-work')).toEqual({ workId });
    expect(await second.submit(input)).toEqual(admitted);
    expect(await (await submission(second, admitted.submissionId)).wait(context)).toMatchObject({
      status: 'done',
      type: 'input',
    });
    const terminal = await entries(second, workId);
    expect(terminal.filter((entry) => UserEntry.is(entry))).toHaveLength(1);
    const answers = terminal
      .filter((entry) => AssistantEntry.is(entry))
      .flatMap((entry) => entry.model ?? []);
    expect(
      answers.filter((message) => message.role === 'assistant' && message.stopReason === 'stop'),
    ).toHaveLength(1);
    expect(
      answers.filter((message) => message.role === 'assistant' && message.stopReason === 'aborted'),
    ).toHaveLength(1);
    expect(await second.listWorks()).toHaveLength(1);
    expect((await second.documents(workId)).work.goal).toBe('Finish the local runtime check');
  }, 30_000);
});
