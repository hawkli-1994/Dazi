import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@earendil-works/chord';
import { BACKGROUND_CONTEXT, awaitWithContext } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import {
  createRegistry,
  defineExtension,
  hook,
  Harness,
  MemoryStorage,
  ToolResultEntry,
  ToolTask,
  type Conversation,
  type JsonObject,
  type Storage,
} from '@earendil-works/pi-durable';
import { getOrThrow } from '@earendil-works/pi-durable/env';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DecisionsDoc, DecisionStatus, WorkDoc } from '../documents';
import { restrictReadEnvironment } from './read-scope';
import { createWorkTools, WorkToolName } from './work-tools';

const context = BACKGROUND_CONTEXT;
const directories: string[] = [];
const opened: Harness[] = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((harness) => harness.close(context)));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'dazi-tools-'));
  directories.push(directory);
  return directory;
}

class CountedEnvironment extends NodeExecutionEnv {
  writes = 0;
  interruptWrite = false;
  override async writeFile(path: string, content: string | Uint8Array, current: Context) {
    this.writes++;
    const result = await super.writeFile(path, content, current);
    if (this.interruptWrite) await awaitWithContext(new Promise<never>(() => {}), current);
    return result;
  }
}

function setupResponses(
  name: string = WorkToolName.Write,
  args: JsonObject = { path: 'result.txt', content: 'hello' },
) {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' }),
    fauxAssistantMessage('Finished'),
  ]);
  return { faux, models };
}

async function open(storage: Storage, env: CountedEnvironment, setup = setupResponses()) {
  const registry = createRegistry();
  const harness = await Harness.open(
    storage,
    { models: setup.models, registry, env: () => env },
    context,
  );
  opened.push(harness);
  registry.install(createWorkTools(harness));
  const model = setup.faux.getModel();
  const root = await harness.root(context, {
    agent: { model: { provider: model.provider, modelId: model.id } },
  });
  await root.commit(async (tx) => {
    const work = await tx.doc(WorkDoc, root.id);
    work.directory = env.cwd;
  }, context);
  return { harness, root, registry };
}

async function pending(harness: Harness, root: Conversation) {
  await vi.waitFor(async () => {
    const state = await harness.snapshot(DecisionsDoc, root.id, context);
    expect(state?.items).toHaveLength(1);
  });
  const state = await harness.snapshot(DecisionsDoc, root.id, context);
  return state!.items[0];
}

async function decide(root: Conversation, approved: boolean) {
  await root.commit(async (tx) => {
    const document = await tx.doc(DecisionsDoc, root.id);
    document.items[0].status = approved ? DecisionStatus.Approved : DecisionStatus.Declined;
  }, context);
}

async function toolResults(root: Conversation) {
  const entries = await root.entries({ order: 'ascending' }, 100, undefined, context);
  return entries.items.filter((entry) => ToolResultEntry.is(entry));
}

describe('work tool approval', () => {
  it('keeps every side-effect tool replay-unsafe', async () => {
    const env = new CountedEnvironment({ cwd: await temporaryDirectory() });
    const { registry } = await open(new MemoryStorage(), env);
    const tools = registry
      .snapshot()
      .tools()
      .map(({ tool }) => tool);
    expect(tools.find((tool) => tool.name === WorkToolName.Read)?.replay).toBe('safe');
    for (const name of [WorkToolName.Write, WorkToolName.Edit, WorkToolName.Bash]) {
      expect(tools.find((tool) => tool.name === name)?.replay).toBe('unsafe');
    }
  });

  it.each<{ name: string; args: JsonObject }>([
    { name: WorkToolName.Write, args: { path: 'result.txt', content: 'hello' } },
    {
      name: WorkToolName.Edit,
      args: { path: 'result.txt', edits: [{ oldText: 'old', newText: 'new' }] },
    },
    { name: WorkToolName.Bash, args: { command: 'must-never-execute' } },
  ])('keeps declined $name before intent and never executes it', async ({ name, args }) => {
    const env = new CountedEnvironment({ cwd: await temporaryDirectory() });
    const shell = vi.spyOn(env, 'exec');
    const fileRead = vi.spyOn(env, 'readTextFile');
    const { harness, root } = await open(new MemoryStorage(), env, setupResponses(name, args));
    const submission = await root.submit(
      { type: 'input', content: 'Run the requested action', requestId: 'declined' },
      context,
    );
    const decision = await pending(harness, root);
    const tasks = await harness.commit(
      (tx) => tx.scanTasks({ kind: ToolTask.definition.name }, 100),
      context,
    );
    expect(tasks.items[0].state).toMatchObject({ checkpoint: { phase: 'call' } });
    expect(decision.arguments).toEqual(args);
    expect(env.writes).toBe(0);
    await decide(root, false);
    await submission.wait(context);
    expect(env.writes).toBe(0);
    expect(shell).not.toHaveBeenCalled();
    expect(fileRead).not.toHaveBeenCalled();
    expect((await toolResults(root))[0].data?.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'blocked' })]),
    );
  });

  it('executes an approved native write once and retains its original output', async () => {
    const env = new CountedEnvironment({ cwd: await temporaryDirectory() });
    const { harness, root } = await open(new MemoryStorage(), env);
    const submission = await root.submit(
      { type: 'input', content: 'Write a file', requestId: 'approved' },
      context,
    );
    await pending(harness, root);
    expect(env.writes).toBe(0);
    await decide(root, true);
    await submission.wait(context);
    expect(env.writes).toBe(1);
    expect(await readFile(join(env.cwd, 'result.txt'), 'utf8')).toBe('hello');
    const result = (await toolResults(root))[0].model?.[0];
    expect(result).toMatchObject({
      role: 'toolResult',
      isError: false,
      content: [{ type: 'text', text: 'Successfully wrote to result.txt' }],
    });
  });

  it('blocks arguments changed by a later hook after approval', async () => {
    const env = new CountedEnvironment({ cwd: await temporaryDirectory() });
    const { harness, root, registry } = await open(new MemoryStorage(), env);
    registry.install(
      defineExtension({
        name: 'test-change-arguments',
        hooks: [
          hook(ToolTask, {
            beforeTool(call) {
              return { arguments: { ...call.arguments, content: 'not-approved' } };
            },
          }),
        ],
      }),
    );
    const submission = await root.submit(
      { type: 'input', content: 'Write a file', requestId: 'changed-arguments' },
      context,
    );
    await pending(harness, root);
    await decide(root, true);
    await submission.wait(context);
    expect(env.writes).toBe(0);
    expect((await toolResults(root))[0].model?.[0]).toMatchObject({ isError: true });
  });

  it('keeps the native edit diff and patch details', async () => {
    const env = new CountedEnvironment({ cwd: await temporaryDirectory() });
    await writeFile(join(env.cwd, 'result.txt'), 'old\n');
    const setup = setupResponses(WorkToolName.Edit, {
      path: 'result.txt',
      edits: [{ oldText: 'old', newText: 'new' }],
    });
    const { harness, root } = await open(new MemoryStorage(), env, setup);
    const submission = await root.submit(
      { type: 'input', content: 'Edit a file', requestId: 'edit-details' },
      context,
    );
    await pending(harness, root);
    await decide(root, true);
    await submission.wait(context);
    expect(env.writes).toBe(1);
    expect((await toolResults(root))[0].model?.[0]).toMatchObject({
      isError: false,
      details: { diff: expect.stringContaining('new'), patch: expect.stringContaining('-old') },
    });
  });

  it('reopens the same pending approval without a duplicate request', async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, 'state.sqlite');
    const env = new CountedEnvironment({ cwd: directory });
    const setup = setupResponses();
    const first = await open(await openNodeSqliteStorage(path), env, setup);
    const submission = await first.root.submit(
      { type: 'input', content: 'Write a file', requestId: 'restart-pending' },
      context,
    );
    const before = await pending(first.harness, first.root);
    await first.harness.close(context);
    const next = await open(await openNodeSqliteStorage(path), env, setup);
    next.harness.resume();
    const after = await pending(next.harness, next.root);
    expect(after.id).toBe(before.id);
    expect(after.taskId).toBe(before.taskId);
    expect(env.writes).toBe(0);
    await decide(next.root, true);
    await (await next.harness.submission(submission.id, context))!.wait(context);
    expect(env.writes).toBe(1);
    expect((await next.harness.snapshot(DecisionsDoc, next.root.id, context))?.items).toHaveLength(
      1,
    );
  });

  it('does not rerun an approved unsafe effect interrupted after it began', async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, 'state.sqlite');
    const env = new CountedEnvironment({ cwd: directory });
    env.interruptWrite = true;
    const setup = setupResponses();
    const first = await open(await openNodeSqliteStorage(path), env, setup);
    const submission = await first.root.submit(
      { type: 'input', content: 'Write a file', requestId: 'restart-effect' },
      context,
    );
    await pending(first.harness, first.root);
    await decide(first.root, true);
    await vi.waitFor(() => expect(env.writes).toBe(1));
    await first.harness.close(context);
    env.interruptWrite = false;
    const next = await open(await openNodeSqliteStorage(path), env, setup);
    next.harness.resume();
    await (await next.harness.submission(submission.id, context))!.wait(context);
    expect(env.writes).toBe(1);
    expect((await toolResults(next.root))[0].data?.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'interrupted' })]),
    );
    expect((await next.harness.snapshot(DecisionsDoc, next.root.id, context))?.items).toHaveLength(
      1,
    );
  });
});

describe('native read scope', () => {
  it('returns the native read output without asking for approval', async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, 'inside.txt'), 'inside');
    const env = new CountedEnvironment({ cwd: directory });
    const { harness, root } = await open(
      new MemoryStorage(),
      env,
      setupResponses(WorkToolName.Read, { path: 'inside.txt' }),
    );
    const submission = await root.submit(
      { type: 'input', content: 'Read this file', requestId: 'read-only' },
      context,
    );
    await submission.wait(context);
    expect((await toolResults(root))[0].model?.[0]).toMatchObject({
      role: 'toolResult',
      isError: false,
      content: [{ type: 'text', text: 'inside' }],
    });
    expect(await harness.snapshot(DecisionsDoc, root.id, context)).toBeUndefined();
  });

  it('allows a real file and rejects traversal, absolute paths, and symlink escapes', async () => {
    const directory = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await writeFile(join(directory, 'inside.txt'), 'inside');
    await writeFile(join(outside, 'outside.txt'), 'outside');
    await symlink(join(outside, 'outside.txt'), join(directory, 'escape.txt'));
    await symlink(outside, join(directory, 'escape-dir'));
    const env = new NodeExecutionEnv({ cwd: directory });
    const guarded = await restrictReadEnvironment(env, directory, context);
    const reader = getOrThrow(await guarded.openBinaryReader('inside.txt', undefined, context));
    expect(new TextDecoder().decode(getOrThrow(await reader.read(0, 6, context)))).toBe('inside');
    await reader.close(context);
    for (const path of [
      join(outside, 'outside.txt'),
      '../outside.txt',
      'escape.txt',
      'escape-dir/outside.txt',
      `file://${join(outside, 'outside.txt')}`,
    ]) {
      const result = await guarded.openBinaryReader(path, undefined, context);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('permission_denied');
    }
  });
});
