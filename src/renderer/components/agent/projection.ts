import type {
  AssistantMessage,
  Message,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from '@earendil-works/pi-ai';
import type {
  ConversationView,
  EntryRecord,
  LiveState,
  NestedToolSlot,
  ToolSlot,
} from '@earendil-works/pi-durable';

// Wire discriminators are kept here; the browser never imports Pi's host runtime.
export const PiEntryKind = {
  User: 'pi.user',
  Assistant: 'pi.assistant',
  ToolResult: 'pi.tool-result',
} as const;
export const PiRole = {
  User: 'user',
  Assistant: 'assistant',
  ToolResult: 'toolResult',
} as const;
export const ContentType = {
  Text: 'text',
  Thinking: 'thinking',
  ToolCall: 'toolCall',
  Image: 'image',
} as const;
export const ToolStatus = {
  Input: 'input',
  Pending: 'pending',
  Running: 'running',
  Success: 'success',
  Error: 'error',
  Interrupted: 'interrupted',
  Missing: 'missing',
  Unknown: 'unknown',
} as const;
export type ToolStatus = (typeof ToolStatus)[keyof typeof ToolStatus];
export const SlotStatus = { Pending: 'pending', Running: 'running', Done: 'done' } as const;
export const StopReason = { Error: 'error', Aborted: 'aborted', Length: 'length' } as const;
export const LIVE_DOC_KIND = 'pi.live';

type VisibleMessage = UserMessage | AssistantMessage | ToolResultMessage;
export type TranscriptRow = {
  key: string;
  entryId?: number;
  modelIndex: number;
  byTaskId?: number;
  message: VisibleMessage;
  live: boolean;
  /** A result stays associated with its immutable record even when displayed inside its call. */
  attachedTo?: string;
  tools: Map<number, ToolProjection>;
};
export type ToolProjection = {
  key: string;
  call: ToolCall;
  contentIndex: number;
  inputStreaming: boolean;
  slot?: ToolSlot;
  result?: TranscriptRow & { message: ToolResultMessage };
  nested: NestedToolProjection[];
};
export type NestedToolProjection = {
  slot: NestedToolSlot;
  children: NestedToolProjection[];
};
export type TranscriptProjection = {
  rows: TranscriptRow[];
  live?: LiveState;
  unmatchedTools: ToolSlot[];
};

function isVisibleMessage(message: Message): message is VisibleMessage {
  return (
    message.role === PiRole.User ||
    message.role === PiRole.Assistant ||
    message.role === PiRole.ToolResult
  );
}

/** pi.live is a built-in typed document carried as JSON across the native view boundary. */
export function readLive(view: ConversationView): LiveState | undefined {
  return view.docs[LIVE_DOC_KIND] as LiveState | undefined;
}

function isPersistedPartial(row: TranscriptRow, message: AssistantMessage, taskId: number) {
  if (row.message.role !== PiRole.Assistant) return false;
  const saved = row.message;
  if (saved.provider !== message.provider || saved.model !== message.model) return false;
  // No text-based deduplication: two legitimate replies may have identical text.
  if (message.responseId && saved.responseId === message.responseId) return true;
  return row.byTaskId === taskId && saved.timestamp === message.timestamp;
}

function appendEntryRows(rows: TranscriptRow[], entry: EntryRecord) {
  if (!Object.values(PiEntryKind).some((kind) => kind === entry.kind)) return;
  entry.model?.forEach((message, modelIndex) => {
    if (!isVisibleMessage(message)) return;
    rows.push({
      key: `entry:${entry.id}:${modelIndex}`,
      entryId: entry.id,
      modelIndex,
      byTaskId: entry.byTaskId,
      message,
      live: false,
      tools: new Map(),
    });
  });
}

export type TranscriptHistory = {
  rows: TranscriptRow[];
  calls: ReadonlyMap<string, readonly ToolProjection[]>;
  rowByTool: ReadonlyMap<string, number>;
  responses: ReadonlyMap<string, readonly TranscriptRow[]>;
  attempts: ReadonlyMap<number, ReadonlyMap<number, readonly TranscriptRow[]>>;
};

function lastMatch<T>(
  items: readonly T[] | undefined,
  matches: (item: T) => boolean,
): T | undefined {
  for (let index = (items?.length ?? 0) - 1; index >= 0; index--) {
    if (matches(items![index])) return items![index];
  }
  return undefined;
}

function addCalls(row: TranscriptRow): void {
  if (row.message.role !== PiRole.Assistant) return;
  row.message.content.forEach((content, contentIndex) => {
    if (content.type !== ContentType.ToolCall) return;
    row.tools.set(contentIndex, {
      key: `${row.key}:content:${contentIndex}`,
      call: content,
      contentIndex,
      inputStreaming: row.live,
      nested: [],
    });
  });
}

/** Project immutable history only when the native entries array identity changes. */
export function projectHistory(entries: readonly EntryRecord[]): TranscriptHistory {
  const rows: TranscriptRow[] = [];
  entries.forEach((entry) => appendEntryRows(rows, entry));
  const calls = new Map<string, ToolProjection[]>();
  const rowByTool = new Map<string, number>();
  const responses = new Map<string, TranscriptRow[]>();
  const attempts = new Map<number, Map<number, TranscriptRow[]>>();
  rows.forEach((row, rowIndex) => {
    addCalls(row);
    for (const tool of row.tools.values()) {
      const candidates = calls.get(tool.call.id) ?? [];
      candidates.push(tool);
      calls.set(tool.call.id, candidates);
      rowByTool.set(tool.key, rowIndex);
    }
    if (row.message.role === PiRole.Assistant) {
      if (row.message.responseId) {
        const sameResponse = responses.get(row.message.responseId) ?? [];
        sameResponse.push(row);
        responses.set(row.message.responseId, sameResponse);
      }
      if (row.byTaskId !== undefined) {
        const task = attempts.get(row.byTaskId) ?? new Map<number, TranscriptRow[]>();
        const attempt = task.get(row.message.timestamp) ?? [];
        attempt.push(row);
        task.set(row.message.timestamp, attempt);
        attempts.set(row.byTaskId, task);
      }
    } else if (row.message.role === PiRole.ToolResult) {
      // Retain every call occurrence: repeated provider call IDs never overwrite earlier rounds.
      const target = lastMatch(calls.get(row.message.toolCallId), (call) => !call.result);
      if (target) {
        target.result = { ...row, message: row.message };
        row.attachedTo = target.key;
      }
    }
  });
  return { rows, calls, rowByTool, responses, attempts };
}

function hasPersistedPartial(
  history: TranscriptHistory,
  message: AssistantMessage,
  taskId: number,
) {
  const byResponse = message.responseId ? history.responses.get(message.responseId) : undefined;
  const byAttempt = history.attempts.get(taskId)?.get(message.timestamp);
  return [...(byResponse ?? []), ...(byAttempt ?? [])].some((row) =>
    isPersistedPartial(row, message, taskId),
  );
}

/**
 * A pure projection of one exact watch()/viewState() snapshot. Cached history is only a derived
 * index, not an event store. Each partial touches its own row and the current tool round only;
 * untouched row identities remain stable for React.memo and Markdown's parsing cache.
 */
export function projectTranscript(
  view: ConversationView,
  history = projectHistory(view.entries),
): TranscriptProjection {
  const live = readLive(view);
  let rows = history.rows;
  let partialRow: TranscriptRow | undefined;
  const partialCalls = new Map<string, ToolProjection[]>();
  const partial = live?.generation?.message;
  if (live?.run && partial && !hasPersistedPartial(history, partial, live.run.taskId)) {
    partialRow = {
      key: `live:${live.run.taskId}:${live.generation!.attempt}:${partial.timestamp}`,
      modelIndex: 0,
      byTaskId: live.run.taskId,
      message: partial,
      live: true,
      tools: new Map(),
    };
    addCalls(partialRow);
    for (const tool of partialRow.tools.values()) {
      const candidates = partialCalls.get(tool.call.id) ?? [];
      candidates.push(tool);
      partialCalls.set(tool.call.id, candidates);
    }
    rows = [...rows, partialRow];
  }

  const unmatchedTools: ToolSlot[] = [];
  const byTask = new Map<number, { nested: NestedToolProjection[] }>();
  const changedRows = new Set<number>();
  for (const slot of live?.tools ?? []) {
    const candidates = history.calls.get(slot.callId);
    const target =
      (slot.entry === undefined
        ? undefined
        : lastMatch(candidates, (call) => call.result?.entryId === slot.entry)) ??
      lastMatch(partialCalls.get(slot.callId), (call) => !call.result) ??
      lastMatch(candidates, (call) => !call.result);
    // A stale slot must not attach to a result from a different task.
    if (
      !target ||
      (slot.taskId !== undefined &&
        target.result?.byTaskId !== undefined &&
        target.result.byTaskId !== slot.taskId)
    ) {
      unmatchedTools.push(slot);
      continue;
    }
    const tool = { ...target, slot, nested: [] as NestedToolProjection[] };
    const rowIndex = history.rowByTool.get(target.key);
    if (rowIndex !== undefined) {
      if (rows === history.rows) rows = [...rows];
      if (!changedRows.has(rowIndex)) {
        rows[rowIndex] = { ...rows[rowIndex], tools: new Map(rows[rowIndex].tools) };
        changedRows.add(rowIndex);
      }
      rows[rowIndex].tools.set(tool.contentIndex, tool);
    } else {
      partialRow?.tools.set(tool.contentIndex, tool);
    }
    if (slot.taskId !== undefined) byTask.set(slot.taskId, tool);
  }
  for (const slot of live?.nestedTools ?? []) {
    const parent = byTask.get(slot.parentTaskId);
    if (!parent) continue;
    const child: NestedToolProjection = { slot, children: [] };
    parent.nested.push(child);
    byTask.set(slot.taskId, { nested: child.children });
  }
  return { rows, live, unmatchedTools };
}

export function toolStatus(
  tool: Pick<ToolProjection, 'result' | 'slot' | 'inputStreaming'>,
): ToolStatus {
  if (tool.result) return tool.result.message.isError ? ToolStatus.Error : ToolStatus.Success;
  if (tool.slot?.status === SlotStatus.Done) {
    return tool.slot.entry === undefined ? ToolStatus.Interrupted : ToolStatus.Missing;
  }
  if (tool.slot?.status === SlotStatus.Running) return ToolStatus.Running;
  if (tool.slot?.status === SlotStatus.Pending) return ToolStatus.Pending;
  return tool.inputStreaming ? ToolStatus.Input : ToolStatus.Unknown;
}

export function nestedToolStatus(slot: NestedToolSlot): ToolStatus {
  if (slot.summary) return slot.summary.isError ? ToolStatus.Error : ToolStatus.Success;
  if (slot.status === SlotStatus.Done) return ToolStatus.Interrupted;
  return slot.status;
}
