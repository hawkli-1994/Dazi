import { describe, expect, it } from 'vitest';
import type { AssistantMessage, Message, ToolResultMessage } from '@earendil-works/pi-ai';
import type {
  ConversationId,
  ConversationView,
  EntryId,
  EntryRecord,
  JsonObject,
  LiveState,
  TaskId,
} from '@earendil-works/pi-durable';
import {
  PiEntryKind,
  ToolStatus,
  nestedToolStatus,
  projectTranscript,
  toolStatus,
} from './projection';

// These test projection semantics only. Host integration tests supply real watch()/viewState() frames.
const conversationId = 1 as ConversationId;
const taskId = 11 as TaskId;
const assistant = (content: AssistantMessage['content'], timestamp = 100): AssistantMessage => ({
  role: 'assistant',
  content,
  api: 'openai-responses',
  provider: 'openai',
  model: 'fixture',
  timestamp,
  stopReason: 'stop',
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
});
const call = (id = 'call-a', name = 'read_file') => ({
  type: 'toolCall' as const,
  id,
  name,
  arguments: { path: 'README.md' },
});
const result = (id = 'call-a', isError = false): ToolResultMessage => ({
  role: 'toolResult',
  toolCallId: id,
  toolName: 'read_file',
  content: [{ type: 'text', text: 'file content' }],
  timestamp: 120,
  isError,
});
const entry = (id: number, model: Message[], byTaskId?: TaskId): EntryRecord => ({
  id: id as EntryId,
  conversationId,
  kind:
    model[0]?.role === 'assistant'
      ? PiEntryKind.Assistant
      : model[0]?.role === 'toolResult'
        ? PiEntryKind.ToolResult
        : PiEntryKind.User,
  model,
  byTaskId,
});
function liveMessage(message: AssistantMessage): NonNullable<LiveState['generation']>['message'] {
  // The native document stores the JSON representation, not readonly provider JSON values.
  return JSON.parse(JSON.stringify(message)) as NonNullable<LiveState['generation']>['message'];
}
function view(entries: EntryRecord[], live?: LiveState): ConversationView {
  return {
    conversation: { id: conversationId },
    entries,
    docs: live ? { 'pi.live': live as unknown as JsonObject } : {},
  };
}

describe('native conversation view projection', () => {
  it('preserves entry order, model indexes, and interleaved content indexes', () => {
    const content: AssistantMessage['content'] = [
      { type: 'text', text: 'First' },
      { type: 'thinking', thinking: 'Published summary' },
      call(),
      { type: 'text', text: 'Last' },
    ];
    const projection = projectTranscript(
      view([
        entry(9, [{ role: 'user', content: '你好', timestamp: 90 }]),
        entry(20, [
          assistant(content),
          assistant([{ type: 'text', text: 'Another model message' }], 101),
        ]),
        entry(30, [result()]),
      ]),
    );
    expect(projection.rows.map((row) => [row.entryId, row.modelIndex])).toEqual([
      [9, 0],
      [20, 0],
      [20, 1],
      [30, 0],
    ]);
    expect(projection.rows[1].message.content).toEqual(content);
    expect([...projection.rows[1].tools.keys()]).toEqual([2]);
    expect(projection.rows[1].tools.get(2)?.result?.entryId).toBe(30);
    expect(projection.rows[3].attachedTo).toBe('entry:20:0:content:2');
  });

  it('shows a partial only during its native active run and replaces it after settlement', () => {
    const partial = assistant([{ type: 'text', text: 'Hello' }]);
    const live: LiveState = {
      run: { taskId, inputs: [] },
      generation: { attempt: 1, message: liveMessage(partial) },
    };
    expect(projectTranscript(view([], live)).rows).toHaveLength(1);
    expect(projectTranscript(view([], { generation: live.generation })).rows).toHaveLength(0);
    const final = { ...partial, content: [{ type: 'text' as const, text: 'Hello world' }] };
    const settled = projectTranscript(view([entry(2, [final], taskId)]));
    expect(settled.rows).toHaveLength(1);
    expect(settled.rows[0].live).toBe(false);
    expect(settled.rows[0].entryId).toBe(2);
    // A repeated/overlapping snapshot cannot duplicate the same response identity.
    expect(projectTranscript(view([entry(2, [final], taskId)], live)).rows).toHaveLength(1);
  });

  it('does not remove a new response merely because its text matches an older reply', () => {
    const text = [{ type: 'text' as const, text: 'Done.' }];
    const projection = projectTranscript(
      view([entry(2, [assistant(text, 100)], taskId)], {
        run: { taskId, inputs: [] },
        generation: { attempt: 1, message: liveMessage(assistant(text, 200)) },
      }),
    );
    expect(projection.rows).toHaveLength(2);
    expect(projection.rows[1].live).toBe(true);
  });

  it('replaces partial argument objects and output instead of concatenating snapshots', () => {
    const before = projectTranscript(
      view([], {
        run: { taskId, inputs: [] },
        generation: {
          attempt: 1,
          message: liveMessage(assistant([{ ...call(), arguments: { path: 'REA' } }])),
        },
      }),
    );
    const after = projectTranscript(
      view([], {
        run: { taskId, inputs: [] },
        generation: {
          attempt: 1,
          message: liveMessage(
            assistant([{ ...call(), arguments: { path: 'README.md', limit: 20 } }]),
          ),
        },
      }),
    );
    expect(before.rows[0].tools.get(0)?.call.arguments).toEqual({ path: 'REA' });
    expect(after.rows[0].tools.get(0)?.call.arguments).toEqual({ path: 'README.md', limit: 20 });
    expect(after.rows[0].key).toBe(before.rows[0].key);
    expect(toolStatus(after.rows[0].tools.get(0)!)).toBe(ToolStatus.Input);
  });

  it('associates results by call ID even when same-name tools finish in reverse order', () => {
    const projection = projectTranscript(
      view(
        [
          entry(2, [assistant([call('a'), call('b')])]),
          entry(3, [result('b', true)], 32 as TaskId),
          entry(4, [result('a')], 31 as TaskId),
        ],
        {
          tools: [
            {
              callId: 'a',
              name: 'read_file',
              status: 'done',
              taskId: 31 as TaskId,
              entry: 4 as EntryId,
            },
            {
              callId: 'b',
              name: 'read_file',
              status: 'done',
              taskId: 32 as TaskId,
              entry: 3 as EntryId,
            },
          ],
        },
      ),
    );
    const [a, b] = [...projection.rows[0].tools.values()];
    expect(a.result?.entryId).toBe(4);
    expect(b.result?.entryId).toBe(3);
    expect(toolStatus(a)).toBe(ToolStatus.Success);
    expect(toolStatus(b)).toBe(ToolStatus.Error);
    expect(a.slot?.taskId).toBe(31);
  });

  it('does not count a done slot without a saved result as success', () => {
    const projection = projectTranscript(
      view([entry(2, [assistant([call()])])], {
        tools: [{ callId: 'call-a', name: 'read_file', status: 'done', taskId }],
      }),
    );
    expect(toolStatus(projection.rows[0].tools.get(0)!)).toBe(ToolStatus.Interrupted);
    expect(
      toolStatus({
        inputStreaming: false,
        slot: { callId: 'a', name: 'read_file', status: 'done', entry: 999 as EntryId },
      }),
    ).toBe(ToolStatus.Missing);
  });

  it('keeps unknown results visible and never assigns a slot by tool name', () => {
    const projection = projectTranscript(
      view([entry(2, [assistant([call('a')])]), entry(3, [result('missing')])], {
        tools: [{ callId: 'different', name: 'read_file', status: 'running', taskId }],
      }),
    );
    expect(projection.rows[1].attachedTo).toBeUndefined();
    expect(projection.rows[0].tools.get(0)?.slot).toBeUndefined();
    expect(projection.unmatchedTools).toHaveLength(1);
  });

  it('rejects a task mismatch and uses parent task IDs for nested calls', () => {
    const projection = projectTranscript(
      view([entry(2, [assistant([call('a'), call('b')])])], {
        tools: [
          { callId: 'a', name: 'read_file', status: 'running', taskId: 31 as TaskId },
          { callId: 'b', name: 'read_file', status: 'running', taskId: 32 as TaskId },
        ],
        nestedTools: [
          {
            callId: 'unrelated-display-id',
            parentCallId: 'a',
            name: 'nested',
            parentTaskId: 32 as TaskId,
            taskId: 33 as TaskId,
            status: 'done',
            arguments: {},
          },
        ],
      }),
    );
    expect(projection.rows[0].tools.get(0)?.nested).toHaveLength(0);
    expect(projection.rows[0].tools.get(1)?.nested[0].slot.taskId).toBe(33);
    expect(nestedToolStatus(projection.rows[0].tools.get(1)!.nested[0].slot)).toBe(
      ToolStatus.Interrupted,
    );

    const mismatch = projectTranscript(
      view([entry(2, [assistant([call('a')])]), entry(3, [result('a')], 31 as TaskId)], {
        tools: [
          {
            callId: 'a',
            name: 'read_file',
            status: 'done',
            taskId: 99 as TaskId,
            entry: 3 as EntryId,
          },
        ],
      }),
    );
    expect(mismatch.rows[0].tools.get(0)?.slot).toBeUndefined();
  });

  it('scopes reused call IDs to each assistant entry and keeps earlier results intact', () => {
    const projection = projectTranscript(
      view(
        [
          entry(2, [assistant([call('reused')], 100)]),
          entry(3, [result('reused')], 31 as TaskId),
          entry(4, [assistant([call('reused')], 200)]),
          entry(5, [result('reused', true)], 32 as TaskId),
          entry(6, [assistant([call('reused')], 300)]),
        ],
        {
          tools: [{ callId: 'reused', name: 'read_file', status: 'running', taskId: 33 as TaskId }],
        },
      ),
    );
    const first = projection.rows[0].tools.get(0)!;
    const second = projection.rows[2].tools.get(0)!;
    const third = projection.rows[4].tools.get(0)!;
    expect(first.result?.entryId).toBe(3);
    expect(second.result?.entryId).toBe(5);
    expect(first.slot).toBeUndefined();
    expect(second.slot).toBeUndefined();
    expect(third.slot?.taskId).toBe(33);
    expect(toolStatus(first)).toBe(ToolStatus.Success);
    expect(toolStatus(second)).toBe(ToolStatus.Error);
    expect(toolStatus(third)).toBe(ToolStatus.Running);
    expect(new Set([first.key, second.key, third.key]).size).toBe(3);
  });

  it('keeps a missing referenced result on its call instead of rendering the tool twice', () => {
    const projection = projectTranscript(
      view([entry(2, [assistant([call('a')])])], {
        tools: [{ callId: 'a', name: 'read_file', status: 'done', taskId, entry: 99 as EntryId }],
      }),
    );
    expect(toolStatus(projection.rows[0].tools.get(0)!)).toBe(ToolStatus.Missing);
    expect(projection.unmatchedTools).toHaveLength(0);
  });

  it('does not label context reset or compaction model text as a user message', () => {
    const head = {
      ...entry(1, [{ role: 'user', content: 'Summarized context', timestamp: 0 }]),
      kind: 'pi.compaction',
    };
    expect(projectTranscript(view([head])).rows).toHaveLength(0);
  });
});
