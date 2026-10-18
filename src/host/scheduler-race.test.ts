import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStorage, UserEntry } from '@earendil-works/pi-durable';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command, Wire, type WorkDocuments } from '../shared/rpc/protocol';
import { Frequency, ScheduleDoc } from './documents';
import { context, HostRuntime } from './runtime';
import { WorkScheduler } from './scheduler';

type ScheduleInput = Omit<WorkDocuments['schedule'], 'lastSlot'>;
const NOW = new Date(2026, 9, 19, 10, 0, 0);
const ORIGINAL: ScheduleInput = {
  enabled: true,
  frequency: Frequency.Daily,
  time: '09:00',
  prompt: 'Summarize the previous task.',
};
const directories: string[] = [];
const runtimes: HostRuntime[] = [];
const schedulers: WorkScheduler[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(
    new Error('Network calls are forbidden in scheduler race tests.'),
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

async function updateSchedule(runtime: HostRuntime, workId: string, schedule: ScheduleInput) {
  return runtime.handle({
    type: Wire.Request,
    id: 'change-schedule',
    command: Command.SetSchedule,
    input: { workId, schedule },
  });
}

async function setup() {
  const storage = new MemoryStorage();
  const runtime = await HostRuntime.open({ storage, testProvider: true });
  runtimes.push(runtime);
  const directory = await mkdtemp(join(tmpdir(), 'dazi-schedule-race-'));
  directories.push(directory);
  const { workId } = await runtime.createWork({
    goal: 'Verify stale scheduled actions cannot start',
    directory,
    requestId: 'scheduled-race-work',
  });
  await updateSchedule(runtime, workId, ORIGINAL);
  const conversation = await runtime.conversation(workId);
  await conversation.commit(async (tx) => {
    (await tx.doc(ScheduleDoc, conversation.id)).lastSlot = '2026-10-01T09:00';
  }, context);
  const scheduler = new WorkScheduler(runtime);
  schedulers.push(scheduler);
  return { storage, runtime, workId, conversation, scheduler };
}

describe('scheduled admission races', () => {
  it.each<{ label: string; schedule: ScheduleInput }>([
    { label: 'disables the schedule', schedule: { ...ORIGINAL, enabled: false, prompt: '' } },
    {
      label: 'changes the prompt',
      schedule: { ...ORIGINAL, prompt: 'Summarize the new task instead.' },
    },
    { label: 'changes the time', schedule: { ...ORIGINAL, time: '11:00' } },
  ])('does not admit a stale tick after the user $label', async ({ schedule }) => {
    const { storage, runtime, workId, conversation, scheduler } = await setup();
    const nativeAdmission = runtime.submitScheduled.bind(runtime);
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const admission = vi.spyOn(runtime, 'submitScheduled').mockImplementation(async (...args) => {
      await paused;
      return nativeAdmission(...args);
    });
    const tick = scheduler.tick(NOW);
    try {
      await vi.waitFor(() => expect(admission).toHaveBeenCalledTimes(1));
      expect(admission.mock.calls[0][0]).toBe(workId);
      expect(admission.mock.calls[0][1]).toBe('2026-10-19T09:00');
      await updateSchedule(runtime, workId, schedule);
      const selected = (await runtime.documents(workId)).schedule;
      release();
      await tick;
      await expect(admission.mock.results[0].value).resolves.toBe(false);
      const submissions = await storage.scanSubmissions(
        { conversationId: conversation.id },
        100,
        undefined,
        context,
      );
      expect(submissions.items).toHaveLength(0);
      const entries = await conversation.entries({ order: 'ascending' }, 100, undefined, context);
      expect(entries.items.filter((entry) => UserEntry.is(entry))).toHaveLength(0);
      expect((await runtime.documents(workId)).schedule).toEqual(selected);
      expect((await runtime.listWorks()).find((work) => work.id === workId)?.error).toBeUndefined();
    } finally {
      // Release even on a failed assertion, so scheduler.close never waits on this test gate.
      release();
      await tick;
    }
  });
});
