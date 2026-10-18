import { localized } from '../i18n';
import { WorkStatus, DossierKind, ArtifactKind, type Work } from '../state/types';
import type { RuntimeSnapshot } from './client';
const text = (value: string) => localized(value, value);
/** Product projection only. Transcript rendering consumes the native view separately. */
export function projectWorks(snapshot: RuntimeSnapshot): Work[] {
  return snapshot.works.map((summary) => {
    const active = summary.id === snapshot.workId;
    const docs = (active ? snapshot.documents : null) ?? summary.documents;
    const pending =
      docs?.decisions.items.filter((item) => item.status === 'pending').length ??
      summary.pendingDecisions;
    const busy =
      active && snapshot.view ? Boolean(snapshot.view.docs['pi.live']?.run) : summary.busy;
    const status = summary.meta.archived
      ? WorkStatus.Archived
      : pending
        ? WorkStatus.Waiting
        : busy
          ? WorkStatus.Running
          : summary.error
            ? WorkStatus.Error
            : summary.settlement?.status === 'done'
              ? WorkStatus.Done
              : WorkStatus.Paused;
    return {
      id: summary.id,
      title: text(summary.meta.title),
      goal: text(summary.meta.goal),
      directory: summary.meta.directory,
      createdAt: summary.meta.createdAt,
      updatedAt: summary.meta.createdAt,
      status,
      summary: summary.error
        ? text(summary.error)
        : busy
          ? localized(
              '正在推进，进展会保存在这项工作里。',
              'Work is running and progress is saved here.',
            )
          : localized(
              '已保存。你可以继续交代下一步。',
              'Saved. You can continue with the next step.',
            ),
      messages: [],
      dossier: (docs?.dossier.notes ?? []).map((note) => ({
        id: note.id,
        kind: DossierKind.Context,
        content: text(note.text),
        source: text(note.sourceEntryId),
      })),
      artifacts: (docs?.artifacts.items ?? []).map((item) => ({
        id: item.id,
        kind: ArtifactKind.Document,
        title: text(item.title),
        path: item.path,
        summary: text(item.path),
        content: text(item.path),
      })),
      plan: (docs?.plan.items ?? []).map((item) => ({
        id: item.id,
        title: text(item.title),
        status: item.status,
      })),
      decisions: (docs?.decisions.items ?? []).map((item) => ({
        id: item.id,
        title: localized(`允许执行 ${item.toolName}？`, `Allow ${item.toolName}?`),
        reason: localized(
          '这项操作需要你确认后才能继续。',
          'This operation needs your approval to continue.',
        ),
        impact: localized(
          '批准后会实际执行下面的操作。',
          'Approval will execute the operation below.',
        ),
        preview: text(JSON.stringify(item.arguments, null, 2)),
        approveLabel: localized('允许这次操作', 'Allow this operation'),
        status: item.status,
      })),
      schedule: docs
        ? {
            enabled: docs.schedule.enabled,
            frequency: docs.schedule.frequency,
            time: docs.schedule.time,
            prompt: docs.schedule.prompt,
          }
        : null,
    };
  });
}
