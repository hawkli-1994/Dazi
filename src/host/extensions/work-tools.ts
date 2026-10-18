import { isDeepStrictEqual } from 'node:util';
import type { Context, Draft, JsonValue } from '@earendil-works/chord';
import { awaitWithContext } from '@earendil-works/chord/context';
import type { TSchema } from '@earendil-works/pi-ai';
import {
  defineExtension,
  hook,
  ToolTask,
  type Extension,
  type HookApi,
  type Session,
  type ToolHookCall,
  type ToolRegistration,
} from '@earendil-works/pi-durable';
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from '@earendil-works/pi-durable/tools';
import type { PendingDecision } from '../../shared/rpc/protocol';
import { DecisionsDoc, DecisionStatus, WorkDoc } from '../documents';
import { restrictReadEnvironment } from './read-scope';

export const WORK_TOOLS_EXTENSION = 'dazi.work-tools';
export const WorkToolName = {
  Read: 'read',
  Write: 'write',
  Edit: 'edit',
  Bash: 'bash',
} as const;
const Replay = { Safe: 'safe', Unsafe: 'unsafe' } as const;
const EFFECT_TOOLS = new Set<string>([WorkToolName.Write, WorkToolName.Edit, WorkToolName.Bash]);

/** Install after Harness.open and before resume; the Harness itself is a Session. */
export function createWorkTools(session: Session): Extension {
  const read = createReadTool();
  const scopedRead: typeof read = {
    ...read,
    // Reads alone may replay. Approval never changes a side effect's replay policy.
    replay: Replay.Safe,
    async execute(args, api, context) {
      const work = await api.snapshot(WorkDoc, api.conversationId, context);
      if (!work?.directory || !api.env)
        throw new Error('Select a work directory before reading files.');
      const env = await restrictReadEnvironment(api.env, work.directory, context);
      return read.execute(args, { ...api, env }, context);
    },
  };
  return defineExtension({
    name: WORK_TOOLS_EXTENSION,
    tools: [
      scopedRead,
      approvedEffect(createWriteTool()),
      approvedEffect(createEditTool()),
      approvedEffect(createBashTool()),
    ],
    hooks: [
      hook(ToolTask, {
        async beforeTool(call, api, context) {
          if (!EFFECT_TOOLS.has(call.name)) return;
          const work = await api.snapshot(WorkDoc, api.conversationId, context);
          if (!work?.directory)
            return { block: 'Select a work directory before running this tool.' };
          // In 1.3.0 this hook precedes the tool's durable execute intent. A restart
          // while awaiting approval revisits this same task ID, without a new request.
          const status = await requestToolDecision(session, call, api, context);
          return status === DecisionStatus.Approved
            ? undefined
            : { block: 'The user declined this action.' };
        },
      }),
    ],
  });
}

/** A later hook must not change the action after the user has reviewed it. */
function approvedEffect<P extends TSchema, D extends JsonValue>(
  tool: ToolRegistration<P, D>,
): ToolRegistration<P, D> {
  return {
    ...tool,
    replay: Replay.Unsafe,
    async execute(args, api, context) {
      const id = String(api.taskId);
      const document = await api.snapshot(DecisionsDoc, api.conversationId, context);
      const decision = document?.items.find((item) => item.id === id);
      if (
        decision?.status !== DecisionStatus.Approved ||
        decision.taskId !== id ||
        decision.toolName !== tool.name ||
        !isDeepStrictEqual(decision.arguments, args)
      )
        throw new Error('This exact action has not been approved.');
      return tool.execute(args, api, context);
    },
  };
}

/** Never infer permission from an absent, changed, or failed decision. */
export async function requestToolDecision(
  session: Session,
  call: ToolHookCall,
  api: Pick<HookApi, 'taskId' | 'conversationId'>,
  context: Context,
): Promise<PendingDecision['status']> {
  const id = String(api.taskId);
  await session.commit(async (tx) => {
    const document = await tx.doc(DecisionsDoc, api.conversationId);
    const existing = document.items.find((item) => item.id === id);
    if (existing) {
      if (
        existing.taskId !== id ||
        existing.toolName !== call.name ||
        !isDeepStrictEqual(existing.arguments, call.arguments)
      ) {
        throw new Error('The action changed after its decision was requested. Start a new action.');
      }
      return;
    }
    document.items.push({
      id,
      taskId: id,
      toolName: call.name,
      arguments: call.arguments,
      status: DecisionStatus.Pending,
    } as Draft<PendingDecision>);
  }, context);

  const watch = await session.watchDoc(DecisionsDoc, api.conversationId, context);
  if (!watch) throw new Error('The action decision is unavailable.');
  try {
    const status = () => watch.value?.items.find((item) => item.id === id)?.status;
    const initial = status();
    if (initial === DecisionStatus.Approved || initial === DecisionStatus.Declined) return initial;
    if (initial !== DecisionStatus.Pending) throw new Error('The action decision is missing.');
    const decision = new Promise<PendingDecision['status']>((resolve, reject) => {
      watch.start(async (value) => {
        const item = value?.items.find((candidate) => candidate.id === id);
        if (!item) reject(new Error('The action decision was removed.'));
        else if (item.status === DecisionStatus.Approved || item.status === DecisionStatus.Declined)
          resolve(item.status);
      });
      void watch.closed.then(() => reject(new Error('The action decision watch closed.')));
    });
    return await awaitWithContext(decision, context);
  } finally {
    await watch.stop();
  }
}
