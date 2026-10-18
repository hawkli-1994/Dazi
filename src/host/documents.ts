import { defineDoc, type ConversationId, type Tx } from '@earendil-works/pi-durable';
import type { ModelChoice, WorkDocuments } from '../shared/rpc/protocol';

export const DocumentKind = {
  Work: 'dazi.work',
  Dossier: 'dazi.dossier',
  Plan: 'dazi.plan',
  Artifacts: 'dazi.artifacts',
  Decisions: 'dazi.decisions',
  Schedule: 'dazi.schedule',
  Settings: 'dazi.settings',
} as const;
export const DecisionStatus = {
  Pending: 'pending',
  Approved: 'approved',
  Declined: 'declined',
} as const;
export const PlanStatus = { Pending: 'pending', InProgress: 'in-progress', Done: 'done' } as const;
export const Frequency = { Daily: 'daily', Weekdays: 'weekdays', Weekly: 'weekly' } as const;

export const WorkDoc = defineDoc<WorkDocuments['work']>({
  kind: DocumentKind.Work,
  version: 1,
  scope: 'conversation',
  history: 'rewindable',
  fork: 'current',
  initial: () => ({ title: '', goal: '', directory: '', archived: false, createdAt: '' }),
});
export const DossierDoc = defineDoc<WorkDocuments['dossier']>({
  kind: DocumentKind.Dossier,
  version: 1,
  scope: 'conversation',
  history: 'rewindable',
  fork: 'current',
  initial: () => ({ notes: [] }),
});
export const PlanDoc = defineDoc<WorkDocuments['plan']>({
  kind: DocumentKind.Plan,
  version: 1,
  scope: 'conversation',
  history: 'rewindable',
  fork: 'current',
  initial: () => ({ items: [] }),
});
export const ArtifactsDoc = defineDoc<WorkDocuments['artifacts']>({
  kind: DocumentKind.Artifacts,
  version: 1,
  scope: 'conversation',
  history: 'rewindable',
  fork: 'current',
  initial: () => ({ items: [] }),
});
export const DecisionsDoc = defineDoc<WorkDocuments['decisions']>({
  kind: DocumentKind.Decisions,
  version: 1,
  scope: 'conversation',
  history: 'rewindable',
  fork: 'current',
  initial: () => ({ items: [] }),
});
export const ScheduleDoc = defineDoc<WorkDocuments['schedule']>({
  kind: DocumentKind.Schedule,
  version: 1,
  scope: 'conversation',
  history: 'rewindable',
  fork: 'current',
  initial: () => ({
    enabled: false,
    frequency: Frequency.Daily,
    time: '09:00',
    prompt: '',
    lastSlot: '',
  }),
});

export const WorkDocTokens = {
  work: WorkDoc,
  dossier: DossierDoc,
  plan: PlanDoc,
  artifacts: ArtifactsDoc,
  decisions: DecisionsDoc,
  schedule: ScheduleDoc,
} as const;

type SettingsState = {
  selectedModel: ModelChoice | null;
  createdRequests: { requestId: string; workId: number }[];
};
export const SettingsDoc = defineDoc<SettingsState>({
  kind: DocumentKind.Settings,
  version: 1,
  scope: 'session',
  initial: () => ({ selectedModel: null, createdRequests: [] }),
});

export async function initializeWorkDocuments(tx: Tx, id: ConversationId): Promise<void> {
  await tx.doc(WorkDoc, id);
  await tx.doc(DossierDoc, id);
  await tx.doc(PlanDoc, id);
  await tx.doc(ArtifactsDoc, id);
  await tx.doc(DecisionsDoc, id);
  await tx.doc(ScheduleDoc, id);
}
