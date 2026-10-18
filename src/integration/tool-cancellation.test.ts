import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LiveDoc, MemoryStorage, type SubmissionId } from '@earendil-works/pi-durable';
import { HostRuntime, context } from '../host/runtime';
import { Command, Wire } from '../shared/rpc/protocol';

describe('native tool and queue cancellation', () => {
  it('stops a running tool and withdraws queued input without rerunning either request', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dazi-tool-cancel-'));
    const runtime = await HostRuntime.open({ storage: new MemoryStorage(), testProvider: true });
    try {
      const { workId } = await runtime.createWork({
        goal: 'Cancel controlled local tool',
        directory,
        requestId: 'create',
      });
      const conversation = await runtime.conversation(workId);
      const firstInput = { workId, text: '[test:tool] [test:visual]', requestId: 'tool-run' };
      const first = await runtime.submit(firstInput);
      await vi.waitFor(
        async () => {
          const live = await runtime.harness.snapshot(LiveDoc, conversation.id, context);
          expect(
            live?.tools?.some(
              (tool) => tool.status === 'running' && tool.output?.includes('test output 1'),
            ),
          ).toBe(true);
        },
        { timeout: 5000 },
      );
      const queuedInput = {
        workId,
        text: 'This queued input must not run',
        requestId: 'queued',
        whenBusy: 'followUp' as const,
      };
      const queued = await runtime.submit(queuedInput);
      await runtime.handle({
        type: Wire.Request,
        id: 'stop',
        command: Command.Abort,
        input: { workId },
      });
      for (const id of [first.submissionId, queued.submissionId]) {
        const submission = await runtime.harness.submission(Number(id) as SubmissionId, context);
        expect(await submission?.wait(context)).toMatchObject({ status: 'unanswered' });
      }
      expect(
        (await runtime.harness.snapshot(LiveDoc, conversation.id, context))?.run,
      ).toBeUndefined();
      const before = await conversation.context(context);
      const serialized = JSON.stringify(before.messages);
      expect(serialized).toContain('test output 1');
      expect(serialized).not.toContain('test output 3');
      expect(serialized).not.toContain('Test provider completed');
      expect(await runtime.submit(firstInput)).toEqual(first);
      expect(await runtime.submit(queuedInput)).toEqual(queued);
      expect(await conversation.context(context)).toEqual(before);
      expect(
        (await runtime.harness.snapshot(LiveDoc, conversation.id, context))?.run,
      ).toBeUndefined();
    } finally {
      await runtime.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
