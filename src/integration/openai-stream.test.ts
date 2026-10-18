import { describe, expect, it } from 'vitest';
import { createModels, Type, type AssistantMessage } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import {
  createRegistry,
  defineExtension,
  defineTool,
  Harness,
  MemoryStorage,
  LiveDoc,
  type LiveState,
} from '@earendil-works/pi-durable';

/** Synthetic HTTP wire fixture through the published official adapter, not a live API test. */
function events(tool: boolean): Record<string, unknown>[] {
  const thinking = {
    type: 'reasoning',
    id: 'rs_fixture',
    summary: [{ type: 'summary_text', text: 'Published reasoning.' }],
  };
  const message = {
    type: 'message',
    id: 'msg_fixture',
    role: 'assistant',
    status: 'completed',
    content: [
      {
        type: 'output_text',
        text: tool ? 'Reading a local fixture.' : 'Fixture complete.',
        annotations: [],
      },
    ],
  };
  const call = {
    type: 'function_call',
    id: 'fc_fixture',
    call_id: 'call_fixture',
    name: 'fixture_read',
    arguments: '{"text":"中文\\nline"}',
  };
  return [
    { type: 'response.created', response: { id: 'resp_fixture', status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...thinking, summary: [] } },
    { type: 'response.reasoning_summary_text.delta', output_index: 0, delta: 'Published ' },
    { type: 'response.reasoning_summary_text.delta', output_index: 0, delta: 'reasoning.' },
    { type: 'response.output_item.done', output_index: 0, item: thinking },
    { type: 'response.output_item.added', output_index: 1, item: { ...message, content: [] } },
    {
      type: 'response.output_text.delta',
      output_index: 1,
      delta: tool ? 'Reading a local ' : 'Fixture ',
    },
    { type: 'response.output_text.delta', output_index: 1, delta: tool ? 'fixture.' : 'complete.' },
    { type: 'response.output_item.done', output_index: 1, item: message },
    ...(tool
      ? [
          { type: 'response.output_item.added', output_index: 2, item: { ...call, arguments: '' } },
          { type: 'response.function_call_arguments.delta', output_index: 2, delta: '{"text":"中' },
          { type: 'response.function_call_arguments.delta', output_index: 2, delta: '文\\nline"}' },
          {
            type: 'response.function_call_arguments.done',
            output_index: 2,
            arguments: call.arguments,
          },
          { type: 'response.output_item.done', output_index: 2, item: call },
        ]
      : []),
    {
      type: 'response.completed',
      response: {
        id: 'resp_fixture',
        status: 'completed',
        usage: { input_tokens: 5, output_tokens: 10, total_tokens: 15 },
      },
    },
  ];
}

describe('official OpenAI Responses adapter wire replay', () => {
  it('drives real Harness partials and a tool round using only injected HTTP bytes', async () => {
    const base = createModels();
    base.setProvider(openaiProvider());
    const model = base.getModels('openai').find((item) => item.api === 'openai-responses');
    if (!model) throw new Error('Published OpenAI model catalog unavailable');
    let requests = 0;
    let calls = 0;
    const fixtureFetch: typeof fetch = async () => {
      const sequence = events(requests++ === 0);
      let index = 0;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          await new Promise((resolve) => setTimeout(resolve, 8));
          if (index === sequence.length) {
            controller.close();
            return;
          }
          const event = sequence[index++];
          controller.enqueue(
            new TextEncoder().encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
          );
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };
    const models = base;
    const streamSimple = base.streamSimple.bind(base);
    models.streamSimple = (selected, input, options) =>
      streamSimple(selected, input, {
        ...options,
        fetch: fixtureFetch,
        apiKey: 'fixture-only-not-a-credential',
        transport: 'sse',
      });
    const registry = createRegistry();
    registry.install(
      defineExtension({
        name: 'fixture.tools',
        tools: [
          defineTool({
            name: 'fixture_read',
            description: 'Read an in-memory fixture',
            replay: 'safe',
            parameters: Type.Object({ text: Type.String() }),
            execute: async (args, api) => {
              calls++;
              expect(args.text).toBe('中文\nline');
              api.output('fixture tool output');
              return {};
            },
          }),
        ],
      }),
    );
    const harness = await Harness.open(
      new MemoryStorage(),
      { models, registry, settings: { progress: { partialIntervalMs: 1, outputIntervalMs: 1 } } },
      BACKGROUND_CONTEXT,
    );
    const conversation = await harness.root(BACKGROUND_CONTEXT, {
      agent: { model: { provider: model.provider, modelId: model.id } },
    });
    const watch = await conversation.watch(BACKGROUND_CONTEXT);
    const partials: AssistantMessage[] = [];
    watch.start(async (view) => {
      const live = view.docs[LiveDoc.definition.kind] as LiveState | undefined;
      if (live?.generation?.message)
        partials.push(structuredClone(live.generation.message) as AssistantMessage);
    });
    try {
      const submission = await conversation.submit(
        { type: 'input', content: 'Run the wire fixture.', requestId: 'wire-fixture' },
        BACKGROUND_CONTEXT,
      );
      const result = await submission.wait(BACKGROUND_CONTEXT);
      expect(result.status, JSON.stringify(result)).toBe('done');
      expect(requests).toBe(2);
      expect(calls).toBe(1);
      expect(
        partials.some((message) =>
          message.content.some(
            (block) => block.type === 'thinking' && block.thinking === 'Published ',
          ),
        ),
      ).toBe(true);
      expect(
        partials.some((message) =>
          message.content.some(
            (block) => block.type === 'toolCall' && block.arguments.text === '中',
          ),
        ),
      ).toBe(true);
      const transcript = await conversation.context(BACKGROUND_CONTEXT);
      expect(
        transcript.messages.some(
          (message) =>
            message.role === 'toolResult' &&
            message.content.some(
              (block) => block.type === 'text' && block.text.includes('fixture tool output'),
            ),
        ),
      ).toBe(true);
      expect(transcript.messages.at(-1)?.role).toBe('assistant');
    } finally {
      await watch.stop();
      await harness.close(BACKGROUND_CONTEXT);
    }
  });
});
