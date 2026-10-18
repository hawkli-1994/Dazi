import { afterEach, describe, expect, it, vi } from 'vitest';
import { Language, localize } from '../i18n';
import { getFixtures } from './fixtures';
import { createDemoStore, demoStore } from './store';
import {
  DecisionStatus,
  DemoErrorCode,
  FixturePreset,
  MessageDelivery,
  MessageRole,
  ScheduleFrequency,
  WorkStatus,
  type WorkSchedule,
} from './types';

const FIXED_NOW = '2026-10-18T10:00:00.000Z';
const makeStore = () => createDemoStore({ now: () => new Date(FIXED_NOW) });
const workId = 'brand-website';
const decisionId = 'brand-decision-1';

function getWork(store: ReturnType<typeof createDemoStore>, id = workId) {
  const work = store.getSnapshot().works.find((item) => item.id === id);
  if (!work) throw new Error(`Test fixture not found: ${id}`);
  return work;
}

afterEach(() => vi.useRealTimers());

describe('memory-only demo store', () => {
  it('opens the application singleton with no preloaded samples', () => {
    expect(demoStore.getSnapshot().works).toEqual([]);
  });

  it('has deterministic waiting, done, running, and error samples', () => {
    const store = makeStore();
    expect(store.getSnapshot().works.map((work) => work.status)).toEqual([
      WorkStatus.Waiting,
      WorkStatus.Done,
      WorkStatus.Running,
      WorkStatus.Error,
    ]);
    expect(store.getSnapshot().works).toEqual(getFixtures());
  });

  it('keeps the snapshot reference stable until a change', () => {
    const store = makeStore();
    const before = store.getSnapshot();
    expect(store.getSnapshot()).toBe(before);
    store.submit('missing', 'A thought');
    expect(store.getSnapshot()).toBe(before);
    store.setLanguage(Language.English);
    expect(store.getSnapshot()).not.toBe(before);
  });

  it('deeply freezes snapshots and leaves previous snapshots intact', () => {
    const store = makeStore();
    const before = store.getSnapshot();
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before.works)).toBe(true);
    expect(Object.isFrozen(getWork(store).messages[0]?.content)).toBe(true);
    store.submit(workId, 'A new thought');
    expect(before.works[0]?.messages).toHaveLength(2);
    expect(getWork(store).messages).toHaveLength(3);
  });

  it('notifies subscribers only for changes and supports unsubscribing', () => {
    const store = makeStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.setLanguage(Language.Chinese);
    store.submit(workId, '  ');
    expect(listener).not.toHaveBeenCalled();
    store.setLanguage(Language.English);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.reset();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('creates work locally with one queued user message and no assistant response', () => {
    const store = makeStore();
    const id = store.createWork('  Plan a small launch  ', '  ~/Projects/launch  ');
    const work = getWork(store, id);
    expect(work.title.en).toBe('Plan a small launch');
    expect(work.goal.zh).toBe('Plan a small launch');
    expect(work.directory).toBe('~/Projects/launch');
    expect(work.status).toBe(WorkStatus.Queued);
    expect(work.createdAt).toBe(FIXED_NOW);
    expect(work.messages).toHaveLength(1);
    expect(work.messages[0]?.role).toBe(MessageRole.User);
    expect(work.messages[0]?.delivery).toBe(MessageDelivery.Queued);
    expect(work.messages[0]?.requestId).toBeTruthy();
    expect(work.artifacts).toEqual([]);
    expect(store.getSnapshot().works[0]?.id).toBe(id);
  });

  it('validates required fields without creating partial work', () => {
    const store = makeStore();
    const before = store.getSnapshot();
    expect(() => store.createWork(' ', '~/')).toThrow(DemoErrorCode.GoalRequired);
    expect(() => store.createWork('A goal', ' ')).toThrow(DemoErrorCode.DirectoryRequired);
    expect(store.getSnapshot()).toBe(before);
  });

  it('keeps full long goals while shortening titles without splitting code points', () => {
    const store = makeStore();
    const goal = '🌱'.repeat(60);
    const work = getWork(store, store.createWork(goal, '~/Ideas'));
    expect(work.goal.zh).toBe(goal);
    expect(work.title.zh).toBe(`${'🌱'.repeat(42)}…`);
  });

  it('adds user input without hiding an outstanding decision', () => {
    const store = makeStore();
    expect(store.submit(workId, '  Keep the original logo.  ')).toBe(true);
    const work = getWork(store);
    expect(work.status).toBe(WorkStatus.Waiting);
    expect(work.messages.at(-1)?.content.en).toBe('Keep the original logo.');
    expect(work.messages.at(-1)?.role).toBe(MessageRole.User);
    expect(work.updatedAt).toBe(FIXED_NOW);
  });

  it('deduplicates retries of the same submission request', () => {
    const store = makeStore();
    expect(store.submit(workId, 'A thought', 'request-123')).toBe(true);
    const before = store.getSnapshot();
    expect(store.submit(workId, 'A thought', 'request-123')).toBe(false);
    expect(store.getSnapshot()).toBe(before);
    expect(getWork(store).messages).toHaveLength(3);
  });

  it('does not invent progress or assistant messages as time passes', () => {
    vi.useFakeTimers();
    const store = makeStore();
    const id = store.createWork('A new idea', '~/Ideas');
    const before = store.getSnapshot();
    vi.advanceTimersByTime(24 * 60 * 60 * 1_000);
    expect(store.getSnapshot()).toBe(before);
    expect(getWork(store, id).messages).toHaveLength(1);
    expect(getWork(store, 'onboarding-flow').status).toBe(WorkStatus.Running);
  });

  it('pauses and retries a sample without executing it', () => {
    const store = makeStore();
    expect(store.abort('onboarding-flow')).toBe(true);
    expect(getWork(store, 'onboarding-flow').status).toBe(WorkStatus.Paused);
    expect(store.abort('onboarding-flow')).toBe(false);
    expect(store.retry('onboarding-flow')).toBe(true);
    expect(getWork(store, 'onboarding-flow').status).toBe(WorkStatus.Queued);
    expect(store.retry('onboarding-flow')).toBe(false);
    expect(store.abort(workId)).toBe(false);
  });

  it('moves the error sample into a clearly queued demo state', () => {
    const store = makeStore();
    expect(store.retry('weekly-insights')).toBe(true);
    expect(getWork(store, 'weekly-insights').status).toBe(WorkStatus.Queued);
    expect(getWork(store, 'weekly-insights').messages).toHaveLength(2);
  });

  it('records an approval once without claiming to publish or complete work', () => {
    const store = makeStore();
    expect(store.resolveDecision(workId, decisionId, DecisionStatus.Approved)).toBe(true);
    const work = getWork(store);
    expect(work.status).toBe(WorkStatus.Queued);
    expect(work.decisions[0]?.status).toBe(DecisionStatus.Approved);
    expect(work.decisions[0]?.result?.en).toContain('does not execute or publish');
    expect(work.messages).toHaveLength(2);
    expect(store.resolveDecision(workId, decisionId, DecisionStatus.Declined)).toBe(false);
  });

  it('records a declined decision and pauses the sample', () => {
    const store = makeStore();
    expect(store.resolveDecision(workId, decisionId, DecisionStatus.Declined)).toBe(true);
    expect(getWork(store).status).toBe(WorkStatus.Paused);
    expect(getWork(store).decisions[0]?.status).toBe(DecisionStatus.Declined);
  });

  it('updates a dossier note in both languages while preserving its category', () => {
    const store = makeStore();
    const before = getWork(store).dossier[0];
    expect(store.updateDossier(workId, 'brand-note-1', '  Keep the existing logo.  ')).toBe(true);
    const updated = getWork(store).dossier[0];
    expect(updated?.content).toEqual({
      zh: 'Keep the existing logo.',
      en: 'Keep the existing logo.',
    });
    expect(updated?.kind).toBe(before?.kind);
    expect(updated?.source.en).toContain('Corrected by you');
    expect(store.updateDossier(workId, 'brand-note-1', 'Keep the existing logo.')).toBe(false);
    expect(store.updateDossier(workId, 'missing', 'A note')).toBe(false);
    expect(store.updateDossier(workId, 'brand-note-1', ' ')).toBe(false);
  });

  it('saves and clears schedule metadata without scheduling any execution', () => {
    const store = makeStore();
    const schedule: WorkSchedule = {
      frequency: ScheduleFrequency.Daily,
      time: '09:00',
      prompt: '  Review progress  ',
      enabled: true,
    };
    expect(store.setSchedule(workId, schedule)).toBe(true);
    expect(getWork(store).schedule?.prompt).toBe('Review progress');
    expect(getWork(store).status).toBe(WorkStatus.Waiting);
    expect(store.setSchedule(workId, { ...schedule, prompt: 'Review progress' })).toBe(false);
    expect(store.setSchedule(workId, { ...schedule, time: '25:00' })).toBe(false);
    expect(store.setSchedule(workId, { ...schedule, prompt: ' ' })).toBe(false);
    expect(store.setSchedule(workId, null)).toBe(true);
    expect(getWork(store).schedule).toBeNull();
  });

  it('saves a disabled schedule without a prompt and rejects enabling it until a prompt is added', () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const disabled: WorkSchedule = {
      frequency: ScheduleFrequency.Daily,
      time: '09:00',
      prompt: '  ',
      enabled: false,
    };
    const before = store.getSnapshot();
    expect(store.setSchedule(workId, disabled)).toBe(true);
    expect(store.getSnapshot()).not.toBe(before);
    expect(getWork(store).schedule).toEqual({ ...disabled, prompt: '' });
    expect(listener).toHaveBeenCalledTimes(1);

    const saved = store.getSnapshot();
    expect(store.setSchedule(workId, { ...disabled, prompt: '' })).toBe(false);
    expect(store.setSchedule(workId, { ...disabled, enabled: true })).toBe(false);
    expect(store.getSnapshot()).toBe(saved);
    expect(listener).toHaveBeenCalledTimes(1);

    expect(
      store.setSchedule(workId, { ...disabled, enabled: true, prompt: 'Review progress' }),
    ).toBe(true);
    expect(getWork(store).schedule?.enabled).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('still validates frequency and time when a schedule is disabled', () => {
    const store = makeStore();
    const before = store.getSnapshot();
    const disabled: WorkSchedule = {
      frequency: ScheduleFrequency.Daily,
      time: '09:00',
      prompt: '',
      enabled: false,
    };
    expect(store.setSchedule(workId, { ...disabled, time: '25:00' })).toBe(false);
    expect(
      store.setSchedule(workId, { ...disabled, frequency: 'invalid' as WorkSchedule['frequency'] }),
    ).toBe(false);
    expect(store.getSnapshot()).toBe(before);
  });

  it('archives work, disables schedules, and rejects later mutations', () => {
    const store = makeStore();
    expect(store.archive('weekly-insights')).toBe(true);
    expect(getWork(store, 'weekly-insights').schedule?.enabled).toBe(false);
    expect(store.archive(workId)).toBe(true);
    expect(getWork(store).status).toBe(WorkStatus.Archived);
    expect(store.submit(workId, 'Another thought')).toBe(false);
    expect(store.resolveDecision(workId, decisionId, DecisionStatus.Approved)).toBe(false);
    expect(store.updateDossier(workId, 'brand-note-1', 'New note')).toBe(false);
    expect(store.retry(workId)).toBe(false);
    expect(store.abort(workId)).toBe(false);
    expect(store.setSchedule(workId, null)).toBe(false);
    expect(store.archive(workId)).toBe(false);
  });

  it('loads empty and default fixtures while keeping the chosen language', () => {
    const store = makeStore();
    store.setLanguage(Language.English);
    store.loadFixtures(FixturePreset.Empty);
    expect(store.getSnapshot().works).toEqual([]);
    store.createWork('A temporary idea', '~/Ideas');
    store.reset();
    expect(store.getSnapshot().works).toEqual([]);
    expect(store.getSnapshot().language).toBe(Language.English);
    store.loadFixtures();
    expect(store.getSnapshot().works).toEqual(getFixtures());
  });

  it('starts each store with clean samples and never shares mutable fixture state', () => {
    const first = makeStore();
    first.archive(workId);
    const second = makeStore();
    expect(getWork(second).status).toBe(WorkStatus.Waiting);
    const fixtures = getFixtures();
    fixtures.splice(0, 1);
    expect(getFixtures()).toHaveLength(4);
    expect(createDemoStore({ preset: FixturePreset.Empty }).getSnapshot().works).toEqual([]);
  });

  it('provides localized fixture text and actual sample deliverable previews', () => {
    const store = makeStore();
    for (const work of store.getSnapshot().works) {
      expect(localize(Language.Chinese, work.title)).not.toEqual('');
      expect(localize(Language.English, work.title)).not.toEqual('');
      for (const artifact of work.artifacts) {
        expect(artifact.content.zh.length).toBeGreaterThan(40);
        expect(artifact.content.en.length).toBeGreaterThan(40);
      }
    }
  });

  it('rejects unknown work and decision targets without notifying', () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.abort('missing')).toBe(false);
    expect(store.retry('missing')).toBe(false);
    expect(store.archive('missing')).toBe(false);
    expect(store.resolveDecision(workId, 'missing', DecisionStatus.Approved)).toBe(false);
    expect(store.submit(workId, 'Content', '')).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });
});
