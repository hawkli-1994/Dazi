import type { Language, LocalizedText } from '../i18n';

export const WorkStatus = {
  Running: 'running',
  Waiting: 'waiting',
  Error: 'error',
  Done: 'done',
  Queued: 'queued',
  Paused: 'paused',
  Archived: 'archived',
} as const;
export type WorkStatus = (typeof WorkStatus)[keyof typeof WorkStatus];

export const DecisionStatus = {
  Pending: 'pending',
  Approved: 'approved',
  Declined: 'declined',
} as const;
export type DecisionStatus = (typeof DecisionStatus)[keyof typeof DecisionStatus];
export type DecisionResult = Exclude<DecisionStatus, typeof DecisionStatus.Pending>;

export const PlanStatus = {
  Pending: 'pending',
  InProgress: 'in-progress',
  Done: 'done',
} as const;
export type PlanStatus = (typeof PlanStatus)[keyof typeof PlanStatus];

export const MessageRole = { User: 'user', Assistant: 'assistant' } as const;
export type MessageRole = (typeof MessageRole)[keyof typeof MessageRole];
export const MessageDelivery = { Sample: 'sample', Queued: 'queued' } as const;
export type MessageDelivery = (typeof MessageDelivery)[keyof typeof MessageDelivery];

export const DossierKind = {
  Decision: 'decision',
  Agreement: 'agreement',
  Context: 'context',
  Pitfall: 'pitfall',
} as const;
export type DossierKind = (typeof DossierKind)[keyof typeof DossierKind];

export const ArtifactKind = { Document: 'document', Design: 'design', Code: 'code' } as const;
export type ArtifactKind = (typeof ArtifactKind)[keyof typeof ArtifactKind];
export const ScheduleFrequency = {
  Daily: 'daily',
  Weekdays: 'weekdays',
  Weekly: 'weekly',
} as const;
export type ScheduleFrequency = (typeof ScheduleFrequency)[keyof typeof ScheduleFrequency];
export const FixturePreset = { Default: 'default', Empty: 'empty' } as const;
export type FixturePreset = (typeof FixturePreset)[keyof typeof FixturePreset];
export const DemoErrorCode = {
  GoalRequired: 'goal-required',
  DirectoryRequired: 'directory-required',
} as const;

export interface WorkMessage {
  readonly id: string;
  readonly role: MessageRole;
  readonly content: LocalizedText;
  readonly createdAt: string;
  readonly delivery: MessageDelivery;
  readonly requestId?: string;
  readonly details?: readonly LocalizedText[];
}

export interface DossierEntry {
  readonly id: string;
  readonly kind: DossierKind;
  readonly content: LocalizedText;
  readonly source: LocalizedText;
}

export interface Artifact {
  readonly id: string;
  readonly kind: ArtifactKind;
  readonly title: LocalizedText;
  readonly path: string;
  readonly summary: LocalizedText;
  readonly content: LocalizedText;
}

export interface PlanItem {
  readonly id: string;
  readonly title: LocalizedText;
  readonly status: PlanStatus;
}

export interface Decision {
  readonly id: string;
  readonly title: LocalizedText;
  readonly reason: LocalizedText;
  readonly impact: LocalizedText;
  readonly preview: LocalizedText;
  readonly approveLabel: LocalizedText;
  readonly status: DecisionStatus;
  readonly result?: LocalizedText;
}

export interface WorkSchedule {
  readonly frequency: ScheduleFrequency;
  readonly time: string;
  readonly prompt: string;
  readonly enabled: boolean;
}

export interface Work {
  readonly id: string;
  readonly title: LocalizedText;
  readonly goal: LocalizedText;
  readonly directory: string;
  readonly status: WorkStatus;
  readonly summary: LocalizedText;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: readonly WorkMessage[];
  readonly dossier: readonly DossierEntry[];
  readonly artifacts: readonly Artifact[];
  readonly plan: readonly PlanItem[];
  readonly decisions: readonly Decision[];
  readonly schedule: WorkSchedule | null;
}

export interface DemoSnapshot {
  readonly works: readonly Work[];
  readonly language: Language;
}
