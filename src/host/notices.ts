import { randomUUID } from 'node:crypto';

/** One notification in flight plus one dirty bit, independent of token-stream ACKs. */
export class LatestNotice<T> {
  #closed = false;
  #dirty = false;
  #running?: Promise<void>;
  #inFlight?: string;

  constructor(
    readonly read: () => Promise<T>,
    readonly send: (id: string, value: T) => void,
    readonly failed: () => void,
  ) {}

  request(): Promise<void> {
    this.#dirty = true;
    return this.pump();
  }

  ack(id: string): boolean {
    if (id !== this.#inFlight) return false;
    this.#inFlight = undefined;
    void this.pump();
    return true;
  }

  private pump(): Promise<void> {
    if (this.#running) return this.#running;
    if (this.#closed || this.#inFlight || !this.#dirty) return Promise.resolve();
    this.#dirty = false;
    this.#running = this.read()
      .then((value) => {
        if (this.#closed) return;
        const id = randomUUID();
        this.#inFlight = id;
        this.send(id, value);
      })
      .catch(() => {
        if (!this.#closed) this.failed();
      })
      .finally(() => {
        this.#running = undefined;
        if (this.#dirty && !this.#inFlight && !this.#closed) void this.pump();
      });
    return this.#running;
  }

  close(): void {
    this.#closed = true;
    this.#dirty = false;
    this.#inFlight = undefined;
  }
}
