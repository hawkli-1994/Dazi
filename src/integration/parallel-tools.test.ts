import { describe, expect, it } from 'vitest';
import {
  createModels,
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
  Type,
} from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { applyImmutable } from '@earendil-works/chord/delta';
import {
  Harness,
  MemoryStorage,
  createRegistry,
  defineExtension,
  defineTool,
  LiveDoc,
  type LiveState,
} from '@earendil-works/pi-durable';

describe('real native parallel tool lifecycle', () => {
  it('preserves call ownership and full outputs when tools complete out of order', async () => {
    const provider = fauxProvider();
    const finalText = 'Canonical final: 中文, code `value`, and an exact ending.';
    provider.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall('fixture_parallel', { name: 'first', delay: 40 }, { id: 'call-first' }),
          fauxToolCall('fixture_parallel', { name: 'second', delay: 5 }, { id: 'call-second' }),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage(finalText),
    ]);
    const models = createModels();
    models.setProvider(provider.provider);
    const registry = createRegistry();
    const completed: string[] = [];
    let active = 0;
    let peak = 0;
    registry.install(
      defineExtension({
        name: 'fixture.parallel',
        tools: [
          defineTool({
            name: 'fixture_parallel',
            description: 'Controlled local concurrency fixture',
            replay: 'safe',
            parameters: Type.Object({ name: Type.String(), delay: Type.Number() }),
            execute: async (args, api) => {
              active++;
              peak = Math.max(peak, active);
              api.output(`${args.name}:start\n`);
              await new Promise((resolve) => setTimeout(resolve, args.delay));
              api.output(`${args.name}:end\n`);
              completed.push(args.name);
              active--;
              return {};
            },
          }),
        ],
      }),
    );
    const harness = await Harness.open(
      new MemoryStorage(),
      { models, registry, settings: { progress: { partialIntervalMs: 1, outputIntervalMs: 1 } } },
      context,
    );
    const conversation = await harness.root(context, {
      agent: { model: { provider: 'faux', modelId: 'faux-1' } },
    });
    const watch = await conversation.watch(context);
    let rebuilt = structuredClone(watch.value);
    const mismatches: boolean[] = [];
    let parallelSeen = false;
    watch.start(async (view, ops) => {
      rebuilt = applyImmutable(rebuilt, ops);
      mismatches.push(JSON.stringify(rebuilt) !== JSON.stringify(view));
      const live = view.docs[LiveDoc.definition.kind] as LiveState;
      if ((live.tools?.filter((tool) => tool.status === 'running').length ?? 0) === 2)
        parallelSeen = true;
    });
    try {
      const submitted = await conversation.submit(
        { type: 'input', content: 'Run controlled parallel tools', requestId: 'parallel-tools' },
        context,
      );
      expect((await submitted.wait(context)).status).toBe('done');
      expect(peak).toBe(2);
      expect(parallelSeen).toBe(true);
      expect(completed).toEqual(['second', 'first']);
      expect(mismatches.some(Boolean)).toBe(false);
      const transcript = await conversation.context(context);
      const results = transcript.messages.filter((message) => message.role === 'toolResult');
      expect(
        results.map((message) => ({
          id: message.toolCallId,
          text: message.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join(''),
        })),
      ).toEqual([
        { id: 'call-first', text: 'first:start\nfirst:end\n' },
        { id: 'call-second', text: 'second:start\nsecond:end\n' },
      ]);
      const final = transcript.messages.at(-1);
      expect(final?.role).toBe('assistant');
      expect(
        final?.role === 'assistant' &&
          final.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join(''),
      ).toBe(finalText);
    } finally {
      await watch.stop();
      await harness.close(context);
    }
  });
});
