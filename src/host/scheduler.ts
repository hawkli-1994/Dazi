import { publicError } from './errors';
import { HostRuntime } from './runtime';
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
        if (await this.runtime.submitScheduled(work.id, slot, schedule))
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
