import { applyImmutable } from '@earendil-works/chord/delta';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type {
  ConversationId,
  ConversationView,
  EntryId,
  EntryRecord,
  JsonObject,
  LiveState,
  TaskId,
} from '@earendil-works/pi-durable';
import { describe, expect, it, vi } from 'vitest';
import { PiEntryKind, projectHistory, projectTranscript } from './projection';

const conversationId = 1 as ConversationId;
function message(content: AssistantMessage['content'], timestamp: number): AssistantMessage {
  return {
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
  };
}
function entry(id: number, assistant: AssistantMessage): EntryRecord {
  return {
    id: id as EntryId,
    conversationId,
    kind: PiEntryKind.Assistant,
    byTaskId: id as TaskId,
    model: [assistant],
  };
}
function view(entries: EntryRecord[], live: LiveState): ConversationView {
  return {
    conversation: { id: conversationId },
    entries,
    docs: { 'pi.live': live as unknown as JsonObject },
  };
}

describe('long transcript streaming performance boundaries', () => {
  it('does not revisit or serialize 1,000 long history entries across 200 native partial deltas', () => {
    const longText = '中文与 English streaming history. '.repeat(300);
    let historicalReads = 0;
    const entries = Array.from({ length: 1000 }, (_, index) => {
      const saved = message([{ type: 'text', text: `${index}: ${longText}` }], index);
      const record = entry(index + 1, saved);
      Object.defineProperty(record, 'model', {
        enumerable: true,
        get: () => {
          historicalReads++;
          return [saved];
        },
      });
      return record;
    });
    const history = projectHistory(entries);
    expect(historicalReads).toBe(1000);
    let current = view(entries, {
      run: { taskId: 2000 as TaskId, inputs: [] },
      generation: {
        attempt: 1,
        message: message([{ type: 'text', text: '' }], 2000) as NonNullable<
          LiveState['generation']
        >['message'],
      },
    });
    const serialized = vi.spyOn(JSON, 'stringify');
    let projection = projectTranscript(current, history);
    let stableRows = true;
    let stableNativeEntries = true;
    try {
      for (let frame = 0; frame < 200; frame++) {
        // Real Chord copy-on-write deltas, not an application stream/event emulation.
        current = applyImmutable(current, [
          [
            'a',
            ['docs', 'pi.live', 'generation', 'message', 'content', 0, 'text'],
            '继续 streaming ',
          ],
        ]);
        projection = projectTranscript(current, history);
        stableNativeEntries &&= current.entries === entries;
        stableRows &&= history.rows.every((row, index) => projection.rows[index] === row);
      }
      expect(serialized).not.toHaveBeenCalled();
    } finally {
      serialized.mockRestore();
    }
    expect(stableNativeEntries).toBe(true);
    expect(stableRows).toBe(true);
    expect(historicalReads).toBe(1000);
    expect(projection.rows).toHaveLength(1001);
    expect(projection.rows[999].message).toBe(history.rows[999].message);
    expect(projection.rows[1000].message.content).toEqual([
      { type: 'text', text: '继续 streaming '.repeat(200) },
    ]);
  });

  it('changes only the active tool owner and leaves previous snapshot/history objects immutable', () => {
    const entries = Array.from({ length: 1000 }, (_, index) =>
      entry(index + 1, message([{ type: 'text', text: 'Old reply' }], index)),
    );
    entries.push(
      entry(
        1001,
        message(
          [{ type: 'toolCall', id: 'active', name: 'read', arguments: { path: 'README.md' } }],
          1001,
        ),
      ),
    );
    const history = projectHistory(entries);
    const firstView = view(entries, {
      tools: [
        {
          callId: 'active',
          name: 'read',
          taskId: 2000 as TaskId,
          status: 'running',
          output: 'first',
        },
      ],
    });
    const first = projectTranscript(firstView, history);
    const nextView = applyImmutable(firstView, [
      ['s', ['docs', 'pi.live', 'tools', 0, 'output'], 'replacement'],
    ]);
    const next = projectTranscript(nextView, history);
    expect(nextView.entries).toBe(entries);
    expect(
      next.rows
        .slice(0, 1000)
        .every((row, index) => row === first.rows[index] && row === history.rows[index]),
    ).toBe(true);
    expect(next.rows[1000]).not.toBe(first.rows[1000]);
    expect(next.rows[1000].tools.get(0)?.slot?.output).toBe('replacement');
    expect(first.rows[1000].tools.get(0)?.slot?.output).toBe('first');
    expect(history.rows[1000].tools.get(0)?.slot).toBeUndefined();
    expect(history.rows[1000].tools.get(0)?.nested).toEqual([]);
  });
});
