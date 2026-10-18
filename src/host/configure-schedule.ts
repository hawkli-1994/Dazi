import type { ConversationId, Tx } from '@earendil-works/pi-durable';
import type { WorkDocuments } from '../shared/rpc/protocol';
import { Frequency, ScheduleDoc } from './documents';
import { HostError, HostErrorCode } from './errors';
import { latestScheduleSlot } from './schedule';

export async function configureSchedule(
  tx: Tx,
  id: ConversationId,
  schedule: Omit<WorkDocuments['schedule'], 'lastSlot'>,
): Promise<void> {
  if (
    typeof schedule.enabled !== 'boolean' ||
    !Object.values(Frequency).includes(schedule.frequency) ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule.time) ||
    typeof schedule.prompt !== 'string' ||
    schedule.prompt.length > 20_000 ||
    (schedule.enabled && !schedule.prompt.trim())
  ) {
    throw new HostError(HostErrorCode.InvalidInput);
  }
  const current = await tx.doc(ScheduleDoc, id);
  const changed =
    !current.enabled ||
    current.time !== schedule.time ||
    current.frequency !== schedule.frequency ||
    current.prompt !== schedule.prompt.trim();
  Object.assign(current, {
    enabled: schedule.enabled,
    frequency: schedule.frequency,
    time: schedule.time,
    prompt: schedule.prompt.trim(),
  });
  // A new choice starts now; reopening catches only the newest missed slot.
  if (schedule.enabled && changed) current.lastSlot = latestScheduleSlot(schedule, new Date());
}
