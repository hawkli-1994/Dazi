import type { WorkDocuments } from '../shared/rpc/protocol';
import { Frequency } from './documents';

type Schedule = WorkDocuments['schedule'];

/** Calendar slots follow the computer's local time; weekly means Monday. */
export function latestScheduleSlot(
  schedule: Pick<Schedule, 'frequency' | 'time'>,
  now: Date,
): string {
  const [hours, minutes] = schedule.time.split(':').map(Number);
  const date = new Date(now);
  date.setHours(hours, minutes, 0, 0);
  if (date > now) date.setDate(date.getDate() - 1);
  while (
    (schedule.frequency === Frequency.Weekdays && (date.getDay() === 0 || date.getDay() === 6)) ||
    (schedule.frequency === Frequency.Weekly && date.getDay() !== 1)
  )
    date.setDate(date.getDate() - 1);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${schedule.time}`;
}
