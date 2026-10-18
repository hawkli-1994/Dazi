import type {
  ConversationView,
  SubmissionSettlement,
  JsonObject,
} from '@earendil-works/pi-durable';
import type { Op } from '@earendil-works/chord/delta';

export const Command = {
  ListWorks: 'listWorks',
  CreateWork: 'createWork',
  SubscribeWork: 'subscribeWork',
  Submit: 'submit',
  Abort: 'abort',
  UpdateDossier: 'updateDossier',
  SetSchedule: 'setSchedule',
  ResolveDecision: 'resolveDecision',
  Archive: 'archive',
  ConfigureModel: 'configureModel',
  ListModels: 'listModels',
} as const;
export const Wire = {
  Request: 'request',
  Response: 'response',
  Snapshot: 'snapshot',
  Delta: 'delta',
  Documents: 'documents',
  Catalog: 'catalog',
  Settlement: 'settlement',
  Ack: 'ack',
  NoticeAck: 'noticeAck',
  Error: 'error',
} as const;
export type ModelChoice = { provider: string; modelId: string };
export type WorkMeta = {
  title: string;
  goal: string;
  directory: string;
  archived: boolean;
  createdAt: string;
};
export type DossierNote = { id: string; text: string; sourceEntryId: string };
export type PendingDecision = {
  id: string;
  toolName: string;
  arguments: JsonObject;
  status: 'pending' | 'approved' | 'declined';
  taskId: string;
};
export type WorkDocuments = {
  work: WorkMeta;
  dossier: { notes: DossierNote[] };
  plan: { items: { id: string; title: string; status: 'pending' | 'in-progress' | 'done' }[] };
  artifacts: { items: { id: string; title: string; path: string; sourceEntryId: string }[] };
  decisions: { items: PendingDecision[] };
  schedule: {
    enabled: boolean;
    frequency: 'daily' | 'weekdays' | 'weekly';
    time: string;
    prompt: string;
    lastSlot: string;
  };
};
export type WorkSummary = {
  id: string;
  meta: WorkMeta;
  busy: boolean;
  pendingDecisions: number;
  settlement?: SubmissionSettlement;
  documents?: WorkDocuments;
  error?: string;
};
export type ModelInfo = ModelChoice & { name: string; configured: boolean };
export type CommandMap = {
  listWorks: { input: Record<string, never>; output: WorkSummary[] };
  createWork: {
    input: { goal: string; directory: string; requestId: string };
    output: { workId: string };
  };
  subscribeWork: {
    input: { workId: string; subscriptionId: string };
    output: { subscriptionId: string };
  };
  submit: {
    input: { workId: string; text: string; requestId: string; whenBusy?: 'followUp' | 'steer' };
    output: { submissionId: string };
  };
  abort: { input: { workId: string }; output: null };
  updateDossier: { input: { workId: string; noteId: string; text: string }; output: null };
  setSchedule: {
    input: { workId: string; schedule: Omit<WorkDocuments['schedule'], 'lastSlot'> };
    output: null;
  };
  resolveDecision: {
    input: { workId: string; decisionId: string; approved: boolean };
    output: null;
  };
  archive: { input: { workId: string }; output: null };
  configureModel: { input: ModelChoice & { workId?: string }; output: null };
  listModels: {
    input: Record<string, never>;
    output: { models: ModelInfo[]; selected: ModelChoice | null };
  };
};
export type Request = {
  [K in keyof CommandMap]: {
    type: typeof Wire.Request;
    id: string;
    command: K;
    input: CommandMap[K]['input'];
  };
}[keyof CommandMap];
export type Response =
  | { type: typeof Wire.Response; id: string; ok: true; value: unknown }
  | { type: typeof Wire.Response; id: string; ok: false; error: string };
export type HostEvent =
  | Response
  | {
      type: typeof Wire.Snapshot;
      subscriptionId: string;
      workId: string;
      sequence: number;
      value: ConversationView;
    }
  | {
      type: typeof Wire.Delta;
      subscriptionId: string;
      workId: string;
      sequence: number;
      ops: readonly Op[];
    }
  | {
      type: typeof Wire.Documents;
      subscriptionId: string;
      workId: string;
      noticeId: string;
      value: WorkDocuments;
    }
  | { type: typeof Wire.Catalog; noticeId: string; works: WorkSummary[] }
  | {
      type: typeof Wire.Settlement;
      workId: string;
      submissionId: string;
      value: SubmissionSettlement;
    }
  | { type: typeof Wire.Error; error: string };
export type ClientMessage =
  | Request
  | { type: typeof Wire.NoticeAck; noticeId: string }
  | { type: typeof Wire.Ack; subscriptionId: string; sequence: number };
