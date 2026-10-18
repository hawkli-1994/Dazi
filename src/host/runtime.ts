import { mkdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels, type Models } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import {
  AgentDoc,
  configure,
  createRegistry,
  Harness,
  LiveDoc,
  type Conversation,
  type ConversationId,
  type ConversationRecord,
  type Cursor,
  type Storage,
  type Submission,
  type SubmissionSettlement,
  type TaskId,
} from '@earendil-works/pi-durable';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import type {
  CommandMap,
  ModelChoice,
  ModelInfo,
  Request,
  WorkDocuments,
  WorkSummary,
} from '../shared/rpc/protocol';
import { Command } from '../shared/rpc/protocol';
import {
  ArtifactsDoc,
  DecisionStatus,
  DecisionsDoc,
  DossierDoc,
  initializeWorkDocuments,
  PlanDoc,
  ScheduleDoc,
  SettingsDoc,
  WorkDoc,
} from './documents';
import { HostError, HostErrorCode, requireText } from './errors';
import { createWorkTools } from './extensions/work-tools';
import { createTestProvider, TestModel, TestTools } from './testing';
import { WorkMemory } from './work-memory';
import { WorkAdmission } from './admission';
import { configureSchedule } from './configure-schedule';
import { isWorkId } from './ids';

export const context = BACKGROUND_CONTEXT;
export type RuntimeOptions = { storagePath?: string; storage?: Storage; testProvider?: boolean };
type SettlementListener = (
  workId: string,
  submissionId: string,
  result: SubmissionSettlement,
) => void;

export class HostRuntime {
  readonly harness: Harness;
  readonly models: Models;
  readonly testProvider: boolean;
  readonly #storage: Storage;
  readonly #settlements = new Set<SettlementListener>();
  readonly #waiting = new Set<number>();
  readonly #changes = new Set<() => void>();
  readonly #scheduleErrors = new Map<string, string>();
  readonly #environments = new Map<string, NodeExecutionEnv>();
  readonly #admission = new WorkAdmission();

  private constructor(harness: Harness, models: Models, testProvider: boolean, storage: Storage) {
    this.harness = harness;
    this.models = models;
    this.testProvider = testProvider;
    this.#storage = storage;
  }

  static async open(options: RuntimeOptions): Promise<HostRuntime> {
    const models = createModels();
    if (options.testProvider) models.setProvider(createTestProvider().provider);
    else {
      models.setProvider(openaiProvider());
      models.setProvider(anthropicProvider());
    }
    const registry = createRegistry();
    let storage = options.storage;
    if (!storage) {
      if (!options.storagePath || !isAbsolute(options.storagePath))
        throw new HostError(HostErrorCode.InvalidInput);
      await mkdir(dirname(options.storagePath), { recursive: true });
      storage = await openNodeSqliteStorage(options.storagePath);
    }
    let runtime: HostRuntime | undefined;
    const harness = await Harness.open(
      storage,
      {
        models,
        registry,
        conversationCreated: async (tx, conversation) =>
          initializeWorkDocuments(tx, conversation.id),
        env: ({ cwd }) => {
          if (!cwd) return undefined;
          let env = runtime ? runtime.#environments.get(cwd) : undefined;
          if (!env) {
            // A working directory is not an OS sandbox. The tool extension gates side effects.
            env = new NodeExecutionEnv({
              cwd,
              shellPath: process.platform === 'win32' ? undefined : '/bin/bash',
            });
            if (runtime) runtime.#environments.set(cwd, env);
          }
          return env;
        },
        onReport: () => {
          console.error('[Host] A runtime operation reported a failure.');
        },
      },
      context,
    );
    runtime = new HostRuntime(harness, models, Boolean(options.testProvider), storage);
    registry.install(createWorkTools(harness));
    registry.install(WorkMemory);
    if (options.testProvider) registry.install(TestTools);
    await harness.commit(async (tx) => {
      const settings = await tx.doc(SettingsDoc);
      if (options.testProvider && !settings.selectedModel) settings.selectedModel = TestModel;
    }, context);
    // Registry and model providers exist before any recovered task is allowed to run.
    harness.resume();
    const pending = (await harness.inspect(context)).submissions;
    for (const record of pending) {
      const submission = await harness.submission(record.id, context);
      if (submission) runtime.trackSubmission(String(record.conversationId), submission);
    }
    return runtime;
  }

  async close(): Promise<void> {
    await this.harness.close(context);
    await Promise.all([...this.#environments.values()].map((env) => env.cleanup(context)));
    this.#environments.clear();
    this.#settlements.clear();
  }

  onSettlement(listener: SettlementListener): () => void {
    this.#settlements.add(listener);
    return () => {
      this.#settlements.delete(listener);
    };
  }

  onChange(listener: () => void): () => void {
    this.#changes.add(listener);
    return () => {
      this.#changes.delete(listener);
    };
  }

  setScheduleError(workId: string, error?: string): void {
    if (this.#scheduleErrors.get(workId) === error) return;
    if (error) this.#scheduleErrors.set(workId, error);
    else this.#scheduleErrors.delete(workId);
    for (const listener of this.#changes) listener();
  }

  trackSubmission(workId: string, submission: Submission): void {
    if (this.#waiting.has(submission.id)) return;
    this.#waiting.add(submission.id);
    void submission
      .wait(context)
      .then((settled) => {
        const value: SubmissionSettlement =
          settled.status === 'done' && settled.type === 'input'
            ? { status: 'done', answer: settled.answer }
            : { status: 'unanswered', reason: settled.reason ?? 'not_an_input' };
        for (const listener of this.#settlements) listener(workId, String(submission.id), value);
      })
      .catch(() => {
        /* Closing preserves pending work for the next Host. */
      })
      .finally(() => this.#waiting.delete(submission.id));
  }

  async conversation(workId: string, allowArchived = false): Promise<Conversation> {
    if (!isWorkId(workId)) {
      throw new HostError(HostErrorCode.WorkNotFound);
    }
    const id = Number(workId) as ConversationId;
    const work = await this.harness.snapshot(WorkDoc, id, context);
    const conversation = await this.harness.conversation(id, context);
    if (!work?.title || !conversation) throw new HostError(HostErrorCode.WorkNotFound);
    if (work.archived && !allowArchived) throw new HostError(HostErrorCode.WorkArchived);
    return conversation;
  }

  async documents(workId: string): Promise<WorkDocuments> {
    const { id } = await this.conversation(workId, true);
    return this.harness.commit(
      async (tx) =>
        JSON.parse(
          JSON.stringify({
            work: await tx.doc(WorkDoc, id),
            dossier: await tx.doc(DossierDoc, id),
            plan: await tx.doc(PlanDoc, id),
            artifacts: await tx.doc(ArtifactsDoc, id),
            decisions: await tx.doc(DecisionsDoc, id),
            schedule: await tx.doc(ScheduleDoc, id),
          }),
        ) as WorkDocuments,
      context,
    );
  }

  async listWorks(): Promise<WorkSummary[]> {
    const conversations = await this.harness.commit(async (tx) => {
      const found: ConversationRecord[] = [];
      let cursor: Cursor | undefined;
      do {
        const page = await tx.scanConversations({}, 100, cursor);
        found.push(...page.items.filter((item) => !item.owner));
        cursor = page.next;
      } while (cursor);
      return found;
    }, context);
    const works: WorkSummary[] = [];
    for (const conversation of conversations) {
      const meta = await this.harness.snapshot(WorkDoc, conversation.id, context);
      if (!meta?.title) continue;
      const documents = await this.documents(String(conversation.id));
      const live = await this.harness.snapshot(LiveDoc, conversation.id, context);
      // The native storage query is read-only; no application settlement table/cache.
      const latest = (
        await this.#storage.scanSubmissions(
          { conversationId: conversation.id, order: 'descending' },
          1,
          undefined,
          context,
        )
      ).items[0];
      const settlement: SubmissionSettlement | undefined =
        latest?.type === 'input' && latest.status === 'done'
          ? { status: 'done', answer: latest.answer }
          : latest?.status === 'unanswered'
            ? { status: 'unanswered', reason: latest.reason }
            : undefined;
      works.push({
        id: String(conversation.id),
        meta,
        busy: Boolean(live?.run),
        documents,
        settlement,
        error:
          this.#scheduleErrors.get(String(conversation.id)) ??
          (settlement?.status === 'unanswered' && settlement.reason !== 'aborted'
            ? HostErrorCode.OperationFailed
            : undefined),
        pendingDecisions: documents.decisions.items.filter(
          (item) => item.status === DecisionStatus.Pending,
        ).length,
      });
    }
    return works.reverse();
  }

  async createWork(input: CommandMap['createWork']['input']): Promise<{ workId: string }> {
    const goal = requireText(input.goal, 20_000);
    const requestId = requireText(input.requestId, 200);
    const requested = requireText(input.directory, 4000);
    if (!isAbsolute(requested)) throw new HostError(HostErrorCode.DirectoryInvalid);
    let directory: string;
    try {
      directory = await realpath(requested);
      if (!(await stat(directory)).isDirectory()) throw new Error();
    } catch {
      throw new HostError(HostErrorCode.DirectoryInvalid);
    }
    const id = await this.harness.commit(async (tx) => {
      const settings = await tx.doc(SettingsDoc);
      const previous = settings.createdRequests.find((item) => item.requestId === requestId);
      if (previous) return previous.workId;
      const conversation = await tx.createConversation({ ownership: { kind: 'ownerless' } });
      const work = await tx.doc(WorkDoc, conversation.id);
      Object.assign(work, {
        title: Array.from(goal.split('\n')[0]).slice(0, 60).join(''),
        goal,
        directory,
        archived: false,
        createdAt: new Date().toISOString(),
      });
      await configure(tx, conversation.id, {
        cwd: directory,
        ...(settings.selectedModel ? { model: settings.selectedModel } : {}),
      });
      settings.createdRequests.push({ requestId, workId: conversation.id });
      return conversation.id;
    }, context);
    return { workId: String(id) };
  }

  async submit(input: CommandMap['submit']['input']): Promise<{ submissionId: string }> {
    return this.#admission.run(input.workId, () => this.admit(input));
  }

  async submitScheduled(
    workId: string,
    slot: string,
    expected: WorkDocuments['schedule'],
  ): Promise<boolean> {
    return this.#admission.run(workId, async () => {
      const conversation = await this.conversation(workId);
      const current = await this.harness.snapshot(ScheduleDoc, conversation.id, context);
      if (
        !current?.enabled ||
        current.lastSlot >= slot ||
        current.time !== expected.time ||
        current.frequency !== expected.frequency ||
        current.prompt !== expected.prompt
      )
        return false;
      await this.admit({
        workId,
        text: current.prompt,
        requestId: `schedule:${workId}:${slot}`,
        whenBusy: 'followUp',
      });
      await conversation.commit(async (tx) => {
        (await tx.doc(ScheduleDoc, conversation.id)).lastSlot = slot;
      }, context);
      return true;
    });
  }

  private async admit(input: CommandMap['submit']['input']): Promise<{ submissionId: string }> {
    const conversation = await this.conversation(input.workId);
    const text = requireText(input.text);
    const requestId = requireText(input.requestId, 200);
    if (input.whenBusy !== undefined && input.whenBusy !== 'followUp' && input.whenBusy !== 'steer')
      throw new HostError(HostErrorCode.InvalidInput);
    const agent = await this.harness.snapshot(AgentDoc, conversation.id, context);
    if (!agent?.model) {
      const selected = (await this.harness.snapshot(SettingsDoc, context))?.selectedModel;
      if (!selected) throw new HostError(HostErrorCode.ModelMissing);
      await conversation.configure({ model: selected }, context);
    }
    const resolved = (await conversation.agent(context)).model;
    if (!resolved) throw new HostError(HostErrorCode.ModelMissing);
    if (!this.testProvider && !(await this.models.checkAuth(resolved.provider)))
      throw new HostError(HostErrorCode.ModelAuthMissing);
    const submission = await conversation.submit(
      { type: 'input', content: text, requestId, whenBusy: input.whenBusy },
      context,
    );
    this.trackSubmission(input.workId, submission);
    return { submissionId: String(submission.id) };
  }

  async listModels(): Promise<CommandMap['listModels']['output']> {
    const configured = new Set<string>();
    for (const provider of this.models.getProviders()) {
      if (this.testProvider || (await this.models.checkAuth(provider.id)))
        configured.add(provider.id);
    }
    const models: ModelInfo[] = this.models
      .getModels()
      .map((model) => ({
        provider: model.provider,
        modelId: model.id,
        name: model.name,
        configured: configured.has(model.provider),
      }))
      .sort((a, b) => a.provider.localeCompare(b.provider) || a.modelId.localeCompare(b.modelId));
    return {
      models,
      selected: (await this.harness.snapshot(SettingsDoc, context))?.selectedModel ?? null,
    };
  }

  async configureModel(input: ModelChoice & { workId?: string }): Promise<null> {
    const model = {
      provider: requireText(input.provider, 100),
      modelId: requireText(input.modelId, 200),
    };
    if (!this.models.getModel(model.provider, model.modelId))
      throw new HostError(HostErrorCode.ModelUnknown);
    if (input.workId) await (await this.conversation(input.workId)).configure({ model }, context);
    else
      await this.harness.commit(async (tx) => {
        (await tx.doc(SettingsDoc)).selectedModel = model;
      }, context);
    return null;
  }

  async handle(request: Request): Promise<unknown> {
    switch (request.command) {
      case Command.ListWorks:
        return this.listWorks();
      case Command.CreateWork:
        return this.createWork(request.input);
      case Command.ListModels:
        return this.listModels();
      case Command.ConfigureModel:
        return this.configureModel(request.input);
      case Command.Submit:
        return this.submit(request.input);
      case Command.Abort: {
        const conversation = await this.conversation(request.input.workId);
        await conversation.abort(context);
        await conversation.commit(async (tx) => {
          for (const decision of (await tx.doc(DecisionsDoc, conversation.id)).items) {
            if (decision.status === DecisionStatus.Pending)
              decision.status = DecisionStatus.Declined;
          }
        }, context);
        return null;
      }
      case Command.Archive: {
        const conversation = await this.#admission.run(request.input.workId, async () => {
          const conversation = await this.conversation(request.input.workId);
          await conversation.commit(async (tx) => {
            (await tx.doc(WorkDoc, conversation.id)).archived = true;
            (await tx.doc(ScheduleDoc, conversation.id)).enabled = false;
          }, context);
          return conversation;
        });
        // The lock protects admission, never a running task or an approval wait.
        await conversation.abort(context);
        return null;
      }
      case Command.UpdateDossier: {
        const conversation = await this.conversation(request.input.workId);
        const text = requireText(request.input.text, 4000);
        await conversation.commit(async (tx) => {
          const dossier = await tx.doc(DossierDoc, conversation.id);
          const note = dossier.notes.find((item) => item.id === request.input.noteId);
          if (!note) throw new HostError(HostErrorCode.NoteMissing);
          const entry = await tx.appendEntry(conversation.id, {
            kind: 'dazi.correction',
            data: { noteId: note.id, text },
          });
          note.text = text;
          note.sourceEntryId = String(entry.id);
        }, context);
        return null;
      }
      case Command.SetSchedule: {
        await this.#admission.run(request.input.workId, async () => {
          const conversation = await this.conversation(request.input.workId);
          await conversation.commit(
            (tx) => configureSchedule(tx, conversation.id, request.input.schedule),
            context,
          );
        });
        this.setScheduleError(request.input.workId);
        return null;
      }
      case Command.ResolveDecision: {
        const conversation = await this.conversation(request.input.workId);
        if (typeof request.input.approved !== 'boolean')
          throw new HostError(HostErrorCode.InvalidInput);
        await conversation.commit(async (tx) => {
          const item = (await tx.doc(DecisionsDoc, conversation.id)).items.find(
            (decision) => decision.id === request.input.decisionId,
          );
          if (!item || item.status !== DecisionStatus.Pending)
            throw new HostError(HostErrorCode.DecisionNotPending);
          const task = await tx.task(Number(item.taskId) as TaskId);
          if (
            !task ||
            task.conversationId !== conversation.id ||
            task.abortRequested ||
            task.state.status === 'terminal' ||
            task.state.status === 'completing'
          )
            throw new HostError(HostErrorCode.DecisionNotPending);
          item.status = request.input.approved ? DecisionStatus.Approved : DecisionStatus.Declined;
        }, context);
        return null;
      }
      default:
        throw new HostError(HostErrorCode.InvalidInput);
    }
  }
}
