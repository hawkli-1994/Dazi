import { ScheduleDoc } from './documents';
import { publicError } from './errors';
import { context, HostRuntime } from './runtime';
import { latestScheduleSlot } from './schedule';

export class WorkScheduler {
  #timer?: ReturnType<typeof setTimeout>;
  #running?: Promise<void>;
  #stopped = false;
  constructor(readonly runtime: HostRuntime) {}

  start(): void {
    const run = () => {
      if (this.#stopped) return;
      void this.tick()
        .catch(() => {
          console.error('[Scheduler] Scheduled work could not be checked.');
        })
        .finally(() => {
          if (!this.#stopped) this.#timer = setTimeout(run, 30_000);
        });
    };
    run();
  }

  tick(now = new Date()): Promise<void> {
    if (this.#running) return this.#running;
    this.#running = this.run(now).finally(() => {
      this.#running = undefined;
    });
    return this.#running;
  }

  private async run(now: Date): Promise<void> {
    for (const work of await this.runtime.listWorks()) {
      if (this.#stopped) return;
      const schedule = work.documents?.schedule;
      if (work.meta.archived || !schedule?.enabled) continue;
      const slot = latestScheduleSlot(schedule, now);
      if (schedule.lastSlot >= slot) continue;
      try {
        await this.runtime.submit({
          workId: work.id,
          text: schedule.prompt,
          requestId: `schedule:${work.id}:${slot}`,
          whenBusy: 'followUp',
        });
        const conversation = await this.runtime.conversation(work.id);
        await conversation.commit(async (tx) => {
          const current = await tx.doc(ScheduleDoc, conversation.id);
          // A changed schedule is a new user choice, not the slot admitted above.
          if (
            current.time === schedule.time &&
            current.frequency === schedule.frequency &&
            current.prompt === schedule.prompt
          )
            current.lastSlot = slot;
        }, context);
        this.runtime.setScheduleError(work.id);
      } catch (error) {
        // A missing model is visible and never reaches provider generation.
        this.runtime.setScheduleError(work.id, publicError(error));
      }
    }
  }

  async close(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    await this.#running;
  }
}
