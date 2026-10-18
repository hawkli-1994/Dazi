/** Short-lived command ordering only. Durable remains the task and inbox scheduler. */
export class WorkAdmission {
  readonly #tails = new Map<string, Promise<void>>();

  async run<T>(workId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(workId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#tails.set(workId, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#tails.get(workId) === current) this.#tails.delete(workId);
    }
  }
}
