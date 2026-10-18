import { Language, localized, type LocalizedText } from '../i18n';
import { getFixtures } from './fixtures';
import {
  DecisionStatus,
  DemoErrorCode,
  FixturePreset,
  MessageDelivery,
  MessageRole,
  ScheduleFrequency,
  WorkStatus,
  type DecisionResult,
  type DemoSnapshot,
  type Work,
  type WorkSchedule,
} from './types';

export interface DemoStoreOptions {
  readonly preset?: FixturePreset;
  readonly language?: Language;
  readonly now?: () => Date;
}

export interface DemoStore {
  readonly getSnapshot: () => DemoSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly createWork: (goal: string, directory: string) => string;
  readonly submit: (workId: string, content: string, requestId?: string) => boolean;
  readonly abort: (workId: string) => boolean;
  readonly retry: (workId: string) => boolean;
  readonly resolveDecision: (workId: string, decisionId: string, result: DecisionResult) => boolean;
  readonly updateDossier: (workId: string, entryId: string, content: string) => boolean;
  readonly setSchedule: (workId: string, schedule: WorkSchedule | null) => boolean;
  readonly archive: (workId: string) => boolean;
  readonly setLanguage: (language: Language) => void;
  readonly loadFixtures: (preset?: FixturePreset) => void;
  readonly reset: () => void;
}

const queuedSummary = localized(
  '想法已暂存。界面演示不会执行任务或生成回复。',
  'Your thought is saved here. The UI demo does not run tasks or generate replies.',
);
const stoppedSummary = localized(
  '已暂停这个示例。没有后台任务在运行。',
  'This sample is paused. No background task is running.',
);

function userText(content: string): LocalizedText {
  return localized(content, content);
}

/** Freeze snapshots so consumers cannot silently mutate the external store. */
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function hasPendingDecision(work: Work): boolean {
  return work.decisions.some((decision) => decision.status === DecisionStatus.Pending);
}

function validSchedule(schedule: WorkSchedule): boolean {
  return (
    Object.values(ScheduleFrequency).includes(schedule.frequency) &&
    /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule.time) &&
    schedule.prompt.trim().length > 0 &&
    typeof schedule.enabled === 'boolean'
  );
}

/**
 * Memory-only renderer adapter for UI exploration. It has no timer, persistence,
 * filesystem, network, model, credential, or background execution integration.
 * Mutations only update local views; sample assistant messages never auto-appear.
 */
export function createDemoStore(options: DemoStoreOptions = {}): DemoStore {
  const now = options.now ?? (() => new Date());
  const listeners = new Set<() => void>();
  let sequence = 0;
  let snapshot = freeze<DemoSnapshot>({
    works: getFixtures(options.preset),
    language: options.language ?? Language.Chinese,
  });

  const timestamp = () => now().toISOString();
  const nextId = (prefix: string) => `demo-${prefix}-${++sequence}`;

  function commit(next: DemoSnapshot): void {
    snapshot = freeze(next);
    listeners.forEach((listener) => listener());
  }

  function changeWork(workId: string, update: (work: Work) => Work | null): boolean {
    const work = snapshot.works.find((item) => item.id === workId);
    if (!work || work.status === WorkStatus.Archived) return false;
    const next = update(work);
    if (!next) return false;
    commit({
      ...snapshot,
      works: snapshot.works.map((item) =>
        item.id === workId ? { ...next, updatedAt: timestamp() } : item,
      ),
    });
    return true;
  }

  function loadFixtures(preset: FixturePreset = FixturePreset.Default): void {
    commit({ ...snapshot, works: getFixtures(preset) });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    createWork(goal, directory) {
      const trimmedGoal = goal.trim();
      const trimmedDirectory = directory.trim();
      if (!trimmedGoal) throw new Error(DemoErrorCode.GoalRequired);
      if (!trimmedDirectory) throw new Error(DemoErrorCode.DirectoryRequired);
      const id = nextId('work');
      const createdAt = timestamp();
      const titleCharacters = Array.from(trimmedGoal.split('\n')[0] ?? trimmedGoal);
      const title =
        titleCharacters.length > 42
          ? `${titleCharacters.slice(0, 42).join('')}…`
          : titleCharacters.join('');
      const work: Work = {
        id,
        title: userText(title),
        goal: userText(trimmedGoal),
        directory: trimmedDirectory,
        status: WorkStatus.Queued,
        summary: queuedSummary,
        createdAt,
        updatedAt: createdAt,
        messages: [
          {
            id: nextId('message'),
            requestId: nextId('request'),
            role: MessageRole.User,
            content: userText(trimmedGoal),
            createdAt,
            delivery: MessageDelivery.Queued,
          },
        ],
        dossier: [],
        artifacts: [],
        plan: [],
        decisions: [],
        schedule: null,
      };
      commit({ ...snapshot, works: [work, ...snapshot.works] });
      return id;
    },
    submit(workId, content, requestId) {
      const trimmedContent = content.trim();
      if (!trimmedContent || requestId?.trim() === '') return false;
      const submissionId = requestId ?? nextId('request');
      return changeWork(workId, (work) => {
        if (work.messages.some((message) => message.requestId === submissionId)) return null;
        return {
          ...work,
          status: hasPendingDecision(work) ? WorkStatus.Waiting : WorkStatus.Queued,
          summary: queuedSummary,
          messages: [
            ...work.messages,
            {
              id: nextId('message'),
              requestId: submissionId,
              role: MessageRole.User,
              content: userText(trimmedContent),
              createdAt: timestamp(),
              delivery: MessageDelivery.Queued,
            },
          ],
        };
      });
    },
    abort(workId) {
      return changeWork(workId, (work) => {
        if (work.status !== WorkStatus.Running && work.status !== WorkStatus.Queued) return null;
        return { ...work, status: WorkStatus.Paused, summary: stoppedSummary };
      });
    },
    retry(workId) {
      return changeWork(workId, (work) => {
        if (work.status !== WorkStatus.Error && work.status !== WorkStatus.Paused) return null;
        return {
          ...work,
          status: hasPendingDecision(work) ? WorkStatus.Waiting : WorkStatus.Queued,
          summary: queuedSummary,
        };
      });
    },
    resolveDecision(workId, decisionId, result) {
      if (result !== DecisionStatus.Approved && result !== DecisionStatus.Declined) return false;
      return changeWork(workId, (work) => {
        const decision = work.decisions.find((item) => item.id === decisionId);
        if (!decision || decision.status !== DecisionStatus.Pending) return null;
        const resultText =
          result === DecisionStatus.Approved
            ? localized(
                '已记录：同意这个方向。演示不会执行或发布内容。',
                'Choice saved: approved. The demo does not execute or publish anything.',
              )
            : localized(
                '已记录：先不做。你可以继续补充想法。',
                'Choice saved: not for now. You can add another thought.',
              );
        const decisions = work.decisions.map((item) =>
          item.id === decisionId ? { ...item, status: result, result: resultText } : item,
        );
        const stillWaiting = decisions.some((item) => item.status === DecisionStatus.Pending);
        return {
          ...work,
          decisions,
          status: stillWaiting
            ? WorkStatus.Waiting
            : result === DecisionStatus.Approved
              ? WorkStatus.Queued
              : WorkStatus.Paused,
          summary: resultText,
        };
      });
    },
    updateDossier(workId, entryId, content) {
      const trimmed = content.trim();
      if (!trimmed) return false;
      return changeWork(workId, (work) => {
        const entry = work.dossier.find((item) => item.id === entryId);
        if (!entry || (entry.content.zh === trimmed && entry.content.en === trimmed)) return null;
        return {
          ...work,
          dossier: work.dossier.map((item) =>
            item.id === entryId
              ? {
                  ...item,
                  content: userText(trimmed),
                  source: localized('你在本次演示中纠正', 'Corrected by you in this demo'),
                }
              : item,
          ),
        };
      });
    },
    setSchedule(workId, schedule) {
      if (schedule !== null && !validSchedule(schedule)) return false;
      const next = schedule === null ? null : { ...schedule, prompt: schedule.prompt.trim() };
      return changeWork(workId, (work) => {
        if (JSON.stringify(work.schedule) === JSON.stringify(next)) return null;
        return { ...work, schedule: next };
      });
    },
    archive(workId) {
      return changeWork(workId, (work) => ({
        ...work,
        status: WorkStatus.Archived,
        schedule: work.schedule ? { ...work.schedule, enabled: false } : null,
      }));
    },
    setLanguage(language) {
      if (language !== Language.Chinese && language !== Language.English) return;
      if (language !== snapshot.language) commit({ ...snapshot, language });
    },
    loadFixtures,
    reset: () => loadFixtures(FixturePreset.Empty),
  };
}

export const demoStore = createDemoStore({ preset: FixturePreset.Empty });
