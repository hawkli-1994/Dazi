import { demoStore } from '../state/store';
import { DecisionStatus, type DecisionResult, type WorkSchedule } from '../state/types';
import { isDesktop, runtimeClient } from './client';
const submissions = new Map<string, { text: string; requestId: string }>();
export const workActions = {
  async createWork(goal: string, directory: string, requestId: string) {
    if (!isDesktop()) return demoStore.createWork(goal, directory);
    return (await runtimeClient.request('createWork', { goal, directory, requestId })).workId;
  },
  async submit(workId: string, text: string) {
    if (!isDesktop()) return demoStore.submit(workId, text);
    const prior = submissions.get(workId);
    const draft = prior?.text === text ? prior : { text, requestId: crypto.randomUUID() };
    submissions.set(workId, draft);
    await runtimeClient.request('submit', { workId, ...draft });
    submissions.delete(workId);
    return true;
  },
  async abort(workId: string) {
    if (!isDesktop()) return demoStore.abort(workId);
    await runtimeClient.request('abort', { workId });
    return true;
  },
  async archive(workId: string) {
    if (!isDesktop()) return demoStore.archive(workId);
    await runtimeClient.request('archive', { workId });
    return true;
  },
  async resolveDecision(workId: string, decisionId: string, result: DecisionResult) {
    if (!isDesktop()) return demoStore.resolveDecision(workId, decisionId, result);
    await runtimeClient.request('resolveDecision', {
      workId,
      decisionId,
      approved: result === DecisionStatus.Approved,
    });
    return true;
  },
  async updateDossier(workId: string, noteId: string, text: string) {
    if (!isDesktop()) return demoStore.updateDossier(workId, noteId, text);
    await runtimeClient.request('updateDossier', { workId, noteId, text });
    return true;
  },
  async setSchedule(workId: string, schedule: WorkSchedule) {
    if (!isDesktop()) return demoStore.setSchedule(workId, schedule);
    await runtimeClient.request('setSchedule', { workId, schedule });
    return true;
  },
};
