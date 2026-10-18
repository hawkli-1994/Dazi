import type {
  CommitPublication,
  ConversationWatch,
  DocumentWatch,
  JsonObject,
} from '@earendil-works/pi-durable';
import { Command, Wire, type HostEvent, type Request } from '../shared/rpc/protocol';
import {
  ArtifactsDoc,
  DecisionsDoc,
  DocumentKind,
  DossierDoc,
  PlanDoc,
  ScheduleDoc,
  WorkDoc,
} from './documents';
import { HostErrorCode, publicError } from './errors';
import { context, HostRuntime } from './runtime';
import { parseClientMessage } from './transport';

type ActiveSubscription = {
  id: string;
  workId: string;
  watch: ConversationWatch;
  docs: DocumentWatch<JsonObject>[];
  sequence: number;
  ack?: { sequence: number; resolve: () => void };
};

/** Refresh the catalog only for low-frequency domain, busy, or terminal changes. */
export function affectsCatalog(publication: CommitPublication): boolean {
  return publication.changes.some((change) => {
    if (change.type === 'conversation' || change.type === 'entry' || change.type === 'submission')
      return true;
    if (change.type !== 'document') return false;
    if (Object.values(DocumentKind).some((kind) => kind === change.record.kind)) return true;
    return (
      change.record.kind === 'pi.live' &&
      change.ops.some((op) => op[0] === 'r' || op[1][0] === 'run')
    );
  });
}

/** One renderer port owns exactly one live native watch and one ACK window. */
export class HostConnection {
  #closed = false;
  #epoch = 0;
  #active?: ActiveSubscription;
  #catalogPending = false;
  #catalogDirty = false;
  readonly #unsubscribe: (() => void)[];

  constructor(
    readonly runtime: HostRuntime,
    readonly send: (event: HostEvent) => void,
  ) {
    this.#unsubscribe = [
      runtime.harness.subscribeCommits((publication) => {
        if (affectsCatalog(publication)) this.queueCatalog();
      }),
      runtime.onSettlement((workId, submissionId, value) => {
        this.emit({ type: Wire.Settlement, workId, submissionId, value });
        this.queueCatalog();
      }),
      runtime.onChange(() => this.queueCatalog()),
    ];
    this.queueCatalog();
  }

  private emit(event: HostEvent): void {
    if (!this.#closed) this.send(event);
  }

  private queueCatalog(): void {
    this.#catalogDirty = true;
    if (this.#catalogPending || this.#closed) return;
    this.#catalogPending = true;
    queueMicrotask(() => {
      void (async () => {
        while (this.#catalogDirty && !this.#closed) {
          this.#catalogDirty = false;
          this.emit({ type: Wire.Catalog, works: await this.runtime.listWorks() });
        }
      })()
        .catch(() => this.emit({ type: Wire.Error, error: HostErrorCode.OperationFailed }))
        .finally(() => {
          this.#catalogPending = false;
          if (this.#catalogDirty && !this.#closed) this.queueCatalog();
        });
    });
  }

  async receive(raw: unknown): Promise<void> {
    if (this.#closed) return;
    let message;
    try {
      message = parseClientMessage(raw);
    } catch (error) {
      this.emit({ type: Wire.Error, error: publicError(error) });
      return;
    }
    if (message.type === Wire.Ack) {
      const active = this.#active;
      if (active?.id === message.subscriptionId && active.ack?.sequence === message.sequence) {
        active.ack.resolve();
        active.ack = undefined;
      }
      return;
    }
    try {
      const value =
        message.command === Command.SubscribeWork
          ? await this.subscribe(message.input.workId, message.input.subscriptionId)
          : await this.runtime.handle(message);
      this.emit({ type: Wire.Response, id: message.id, ok: true, value });
    } catch (error) {
      this.emit({ type: Wire.Response, id: message.id, ok: false, error: publicError(error) });
    }
  }

  private async stopActive(): Promise<void> {
    const active = this.#active;
    this.#active = undefined;
    if (!active) return;
    active.ack?.resolve();
    await Promise.all([active.watch.stop(), ...active.docs.map((watch) => watch.stop())]);
  }

  private waitForAck(
    active: ActiveSubscription,
    sequence: number,
    event: HostEvent,
  ): Promise<void> {
    // Install before postMessage: tests and in-process transports can ACK synchronously.
    return new Promise((resolve) => {
      active.ack = { sequence, resolve };
      this.emit(event);
    });
  }

  private async subscribe(
    workId: string,
    subscriptionId: string,
  ): Promise<{ subscriptionId: string }> {
    const epoch = ++this.#epoch;
    await this.stopActive();
    const conversation = await this.runtime.conversation(workId, true);
    const watch = await conversation.watch(context);
    const harness = this.runtime.harness;
    const docs = (
      await Promise.all([
        harness.watchDoc(WorkDoc, conversation.id, context),
        harness.watchDoc(DossierDoc, conversation.id, context),
        harness.watchDoc(PlanDoc, conversation.id, context),
        harness.watchDoc(ArtifactsDoc, conversation.id, context),
        harness.watchDoc(DecisionsDoc, conversation.id, context),
        harness.watchDoc(ScheduleDoc, conversation.id, context),
      ])
    ).filter((doc): doc is NonNullable<typeof doc> => Boolean(doc));
    if (this.#closed || epoch !== this.#epoch) {
      await Promise.all([watch.stop(), ...docs.map((doc) => doc.stop())]);
      return { subscriptionId };
    }
    const active: ActiveSubscription = { id: subscriptionId, workId, watch, docs, sequence: 0 };
    this.#active = active;
    const initialAck = this.waitForAck(active, 0, {
      type: Wire.Snapshot,
      subscriptionId,
      workId,
      sequence: 0,
      value: watch.value,
    });
    const value = await this.runtime.documents(workId);
    if (this.#active !== active) return { subscriptionId };
    this.emit({ type: Wire.Documents, subscriptionId, workId, value });
    let documentsPending = false;
    let documentsDirty = false;
    const queueDocuments = () => {
      documentsDirty = true;
      if (documentsPending) return;
      documentsPending = true;
      queueMicrotask(() => {
        void (async () => {
          while (documentsDirty && this.#active === active) {
            documentsDirty = false;
            const current = await this.runtime.documents(workId);
            if (this.#active === active)
              this.emit({ type: Wire.Documents, subscriptionId, workId, value: current });
          }
        })()
          .catch(() => this.emit({ type: Wire.Error, error: HostErrorCode.OperationFailed }))
          .finally(() => {
            documentsPending = false;
            if (documentsDirty && this.#active === active) queueDocuments();
          });
      });
    };
    for (const doc of docs)
      doc.start(async () => {
        queueDocuments();
      });
    watch.start(async (_value, ops) => {
      await initialAck;
      if (this.#active !== active) return;
      const sequence = ++active.sequence;
      // Keeping this promise pending activates Durable's native 100-frame coalescing.
      await this.waitForAck(active, sequence, {
        type: Wire.Delta,
        subscriptionId,
        workId,
        sequence,
        ops,
      });
    });
    void watch.closed.then((end) => {
      if (this.#active === active && end.reason !== 'stopped') {
        this.emit({ type: Wire.Error, error: HostErrorCode.ConnectionClosed });
      }
    });
    return { subscriptionId };
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    ++this.#epoch;
    for (const unsubscribe of this.#unsubscribe) unsubscribe();
    await this.stopActive();
  }
}

export type HostRequest = Request;
