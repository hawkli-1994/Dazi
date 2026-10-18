import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStorage, UserEntry } from '@earendil-works/pi-durable';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command, Wire, type WorkDocuments } from '../shared/rpc/protocol';
import { Frequency, ScheduleDoc } from './documents';
import { HostErrorCode } from './errors';
import { context, HostRuntime } from './runtime';
import { latestScheduleSlot } from './schedule';
import { WorkScheduler } from './scheduler';

type ScheduleInput = Omit<WorkDocuments['schedule'], 'lastSlot'>;
const NOW = new Date(2026, 9, 19, 10, 0, 0);
const directories: string[] = [];
const runtimes: HostRuntime[] = [];
const schedulers: WorkScheduler[] = [];
const enabled: ScheduleInput = {
  enabled: true,
  frequency: Frequency.Daily,
  time: '09:00',
  prompt: 'Summarize progress.',
};

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(
    new Error('Network calls are forbidden in scheduler tests.'),
  );
});

afterEach(async () => {
  await Promise.all(schedulers.splice(0).map((scheduler) => scheduler.close()));
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function setup(testProvider = true) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const storage = new MemoryStorage();
  const runtime = await HostRuntime.open({ storage, testProvider });
  runtimes.push(runtime);
  const directory = await mkdtemp(join(tmpdir(), 'dazi-scheduler-'));
  directories.push(directory);
  const { workId } = await runtime.createWork({
    goal: 'Check scheduled progress',
    directory,
    requestId: 'scheduled-work',
  });
  const scheduler = new WorkScheduler(runtime);
  schedulers.push(scheduler);
  return { runtime, storage, scheduler, workId };
}

async function setSchedule(runtime: HostRuntime, workId: string, schedule: ScheduleInput) {
  return runtime.handle({
    type: Wire.Request,
    id: 'schedule-command',
    command: Command.SetSchedule,
    input: { workId, schedule },
  });
}

async function setPreviousSlot(runtime: HostRuntime, workId: string, slot = '2026-10-01T09:00') {
  const conversation = await runtime.conversation(workId);
  await conversation.commit(async (tx) => {
    (await tx.doc(ScheduleDoc, conversation.id)).lastSlot = slot;
  }, context);
}

describe('latestScheduleSlot local calendar boundaries', () => {
  it.each([
    {
      frequency: Frequency.Daily,
      now: new Date(2026, 9, 19, 8, 59, 59),
      expected: '2026-10-18T09:00',
    },
    {
      frequency: Frequency.Daily,
      now: new Date(2026, 9, 19, 9, 0, 0),
      expected: '2026-10-19T09:00',
    },
    {
      frequency: Frequency.Daily,
      now: new Date(2026, 9, 19, 23, 59, 59),
      expected: '2026-10-19T09:00',
    },
    {
      frequency: Frequency.Daily,
      now: new Date(2027, 0, 1, 8, 0, 0),
      expected: '2026-12-31T09:00',
    },
    {
      frequency: Frequency.Weekdays,
      now: new Date(2026, 9, 18, 12, 0, 0),
      expected: '2026-10-16T09:00',
    },
    {
      frequency: Frequency.Weekdays,
      now: new Date(2026, 9, 19, 8, 59, 59),
      expected: '2026-10-16T09:00',
    },
    {
      frequency: Frequency.Weekdays,
      now: new Date(2026, 9, 19, 9, 0, 0),
      expected: '2026-10-19T09:00',
    },
    {
      frequency: Frequency.Weekly,
      now: new Date(2026, 9, 19, 8, 59, 59),
      expected: '2026-10-12T09:00',
    },
    {
      frequency: Frequency.Weekly,
      now: new Date(2026, 9, 19, 9, 0, 0),
      expected: '2026-10-19T09:00',
    },
    {
      frequency: Frequency.Weekly,
      now: new Date(2026, 9, 25, 23, 59, 59),
      expected: '2026-10-19T09:00',
    },
    {
      frequency: Frequency.Weekly,
      now: new Date(2027, 0, 1, 12, 0, 0),
      expected: '2026-12-28T09:00',
    },
  ])(
    '$frequency resolves the latest eligible local slot to $expected',
    ({ frequency, now, expected }) => {
      expect(latestScheduleSlot({ frequency, time: '09:00' }, now)).toBe(expected);
    },
  );
});

describe('WorkScheduler durable admission', () => {
  it('allows disabling with an empty prompt and rejects enabling an empty prompt', async () => {
    const { runtime, workId } = await setup();
    await expect(
      setSchedule(runtime, workId, { ...enabled, enabled: false, prompt: '' }),
    ).resolves.toBeNull();
    expect((await runtime.documents(workId)).schedule).toMatchObject({
      enabled: false,
      prompt: '',
    });
    await expect(setSchedule(runtime, workId, { ...enabled, prompt: '   ' })).rejects.toThrow(
      HostErrorCode.InvalidInput,
    );
    expect((await runtime.documents(workId)).schedule).toMatchObject({
      enabled: false,
      prompt: '',
    });
  });

  it('sets the current slot when enabled without immediately running old slots', async () => {
    const { runtime, storage, scheduler, workId } = await setup();
    const submit = vi.spyOn(runtime, 'submitScheduled');
    await setSchedule(runtime, workId, enabled);
    expect((await runtime.documents(workId)).schedule.lastSlot).toBe('2026-10-19T09:00');
    await scheduler.tick(NOW);
    expect(submit).not.toHaveBeenCalled();
    const conversation = await runtime.conversation(workId);
    expect(
      (await storage.scanSubmissions({ conversationId: conversation.id }, 100, undefined, context))
        .items,
    ).toHaveLength(0);
  });

  it('catches up only the newest missed slot and admits it once across repeated/concurrent ticks', async () => {
    const { runtime, storage, scheduler, workId } = await setup();
    await setSchedule(runtime, workId, enabled);
    await setPreviousSlot(runtime, workId);
    const submit = vi.spyOn(runtime, 'submitScheduled');
    const firstTick = scheduler.tick(NOW);
    expect(scheduler.tick(NOW)).toBe(firstTick);
    await firstTick;
    await scheduler.tick(NOW);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(workId, '2026-10-19T09:00', {
      ...enabled,
      lastSlot: '2026-10-01T09:00',
    });
    expect((await runtime.documents(workId)).schedule.lastSlot).toBe('2026-10-19T09:00');
    const conversation = await runtime.conversation(workId);
    await conversation.waitForIdle(context);
    const admissions = await storage.scanSubmissions(
      { conversationId: conversation.id },
      100,
      undefined,
      context,
    );
    expect(admissions.items).toHaveLength(1);
    expect(admissions.items[0]).toMatchObject({
      requestId: `schedule:${workId}:2026-10-19T09:00`,
      status: 'done',
    });
    const entries = await conversation.entries({ order: 'ascending' }, 100, undefined, context);
    expect(entries.items.filter((entry) => UserEntry.is(entry))).toHaveLength(1);
    // Reopening the loop object also respects the durable last-slot checkpoint.
    await scheduler.close();
    const replacement = new WorkScheduler(runtime);
    schedulers.push(replacement);
    await replacement.tick(NOW);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('reports an unconfigured production model in the catalog without auth or provider lookup', async () => {
    const { runtime, storage, scheduler, workId } = await setup(false);
    await setSchedule(runtime, workId, enabled);
    await setPreviousSlot(runtime, workId);
    const auth = vi
      .spyOn(runtime.models, 'checkAuth')
      .mockRejectedValue(new Error('Credentials must not be accessed.'));
    const model = vi.spyOn(runtime.models, 'getModel').mockImplementation(() => {
      throw new Error('No provider lookup is allowed.');
    });
    const changed = vi.fn();
    runtime.onChange(changed);
    await scheduler.tick(NOW);
    expect((await runtime.listWorks()).find((work) => work.id === workId)?.error).toBe(
      HostErrorCode.ModelMissing,
    );
    expect(changed).toHaveBeenCalledTimes(1);
    expect(auth).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
    const conversation = await runtime.conversation(workId);
    expect(
      (await storage.scanSubmissions({ conversationId: conversation.id }, 100, undefined, context))
        .items,
    ).toHaveLength(0);
    expect((await runtime.documents(workId)).schedule.lastSlot).toBe('2026-10-01T09:00');
    await scheduler.tick(NOW);
    expect(changed).toHaveBeenCalledTimes(1);
    await setSchedule(runtime, workId, { ...enabled, enabled: false, prompt: '' });
    expect((await runtime.listWorks()).find((work) => work.id === workId)?.error).toBeUndefined();
  });

  it('closes its active loop and does not admit further slots', async () => {
    const { runtime, storage, scheduler, workId } = await setup();
    await setSchedule(runtime, workId, enabled);
    const submit = vi.spyOn(runtime, 'submitScheduled');
    scheduler.start();
    await scheduler.close();
    await setPreviousSlot(runtime, workId);
    await scheduler.tick(new Date(2026, 9, 20, 10));
    expect(submit).not.toHaveBeenCalled();
    const conversation = await runtime.conversation(workId);
    expect(
      (await storage.scanSubmissions({ conversationId: conversation.id }, 100, undefined, context))
        .items,
    ).toHaveLength(0);
  });
});
