import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createModels, Type, type AssistantMessage } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { applyImmutable } from '@earendil-works/chord/delta';
import {
  createRegistry,
  defineExtension,
  defineTool,
  Harness,
  MemoryStorage,
  LiveDoc,
  type LiveState,
} from '@earendil-works/pi-durable';

const Fixture = {
  Tool: 'fixture_read',
  Arguments: '中文\nline',
  Reasoning: 'Published reasoning.',
  Signature: 'synthetic-signature-not-from-a-provider',
  Output: 'fixture tool output\n中文',
  Final: 'Fixture complete. 中文\nAll output preserved.',
} as const;

afterEach(() => vi.restoreAllMocks());

/** Synthetic Anthropic SSE bytes, not a live API response or a credential test.
 * Shapes follow installed pi-ai 1.3.0 api/anthropic-messages.js:
 * iterateAnthropicEvents and the message/content-block delta handlers.
 */
function events(model: string, tool: boolean): Record<string, unknown>[] {
  return [
    {
      type: 'message_start',
      message: {
        id: tool ? 'msg_fixture_tool' : 'msg_fixture_final',
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 0 },
      },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '', signature: '' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'Published ' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'reasoning.' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'signature_delta', signature: Fixture.Signature },
    },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'text_delta', text: tool ? 'Reading a local ' : 'Fixture ' },
    },
    {
      type: 'content_block_delta',
      index: 1,
      delta: {
        type: 'text_delta',
        text: tool ? 'fixture.' : 'complete. 中文\nAll output preserved.',
      },
    },
    { type: 'content_block_stop', index: 1 },
    ...(tool
      ? [
          {
            type: 'content_block_start',
            index: 2,
            content_block: { type: 'tool_use', id: 'toolu_fixture', name: Fixture.Tool, input: {} },
          },
          {
            type: 'content_block_delta',
            index: 2,
            delta: { type: 'input_json_delta', partial_json: '{"text":"中' },
          },
          {
            type: 'content_block_delta',
            index: 2,
            delta: { type: 'input_json_delta', partial_json: '文\\nline"}' },
          },
          { type: 'content_block_stop', index: 2 },
        ]
      : []),
    {
      type: 'message_delta',
      delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null },
      usage: { output_tokens: 17 },
    },
    { type: 'message_stop' },
  ];
}

function response(sequence: Record<string, unknown>[]): Response {
  const chunks = sequence.flatMap((event) => {
    const bytes = new TextEncoder().encode(
      `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
    );
    const unicode = bytes.indexOf(0xe4); // Split inside a Chinese UTF-8 code point when present.
    const split = unicode >= 0 ? unicode + 1 : Math.floor(bytes.length / 2);
    return [bytes.slice(0, split), bytes.slice(split)];
  });
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        await delay(8);
        if (index === chunks.length) controller.close();
        else controller.enqueue(chunks[index++]);
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

describe('official Anthropic Messages adapter wire replay', () => {
  it('preserves public thinking, partial JSON, native tool output, and the complete final answer', async () => {
    const globalFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Real network is forbidden in this replay.'));
    const env = vi.fn(async () => {
      throw new Error('Credential environment access is forbidden.');
    });
    const fileExists = vi.fn(async () => {
      throw new Error('Credential file access is forbidden.');
    });
    const models = createModels({ authContext: { env, fileExists } });
    models.setProvider(anthropicProvider());
    const model = models
      .getModels('anthropic')
      .find((item) => item.api === 'anthropic-messages' && item.reasoning);
    if (!model) throw new Error('Published Anthropic model catalog unavailable');
    const requests: Record<string, unknown>[] = [];
    let calls = 0;
    const fixtureFetch: typeof fetch = async (input, options) => {
      const request = new Request(input, options);
      expect(new URL(request.url).pathname).toBe('/v1/messages');
      expect(request.method).toBe('POST');
      requests.push((await request.json()) as Record<string, unknown>);
      if (requests.length > 2) throw new Error('Unexpected provider retry in the fixture.');
      return response(events(model.id, requests.length === 1));
    };
    const streamSimple = models.streamSimple.bind(models);
    models.streamSimple = (selected, input, options) =>
      streamSimple(selected, input, {
        ...options,
        fetch: fixtureFetch,
        apiKey: 'fixture-only-not-a-credential',
        cacheRetention: 'none',
        reasoning: 'low',
        maxRetries: 0,
        transport: 'sse',
      });
    const registry = createRegistry();
    registry.install(
      defineExtension({
        name: 'fixture.anthropic-tools',
        tools: [
          defineTool({
            name: Fixture.Tool,
            description: 'Read an in-memory test fixture',
            replay: 'safe',
            parameters: Type.Object({ text: Type.String() }),
            execute: async (args, api, context) => {
              calls++;
              expect(args).toEqual({ text: Fixture.Arguments });
              api.output('fixture ');
              await api.details({ step: 1 }, context);
              await delay(16);
              api.output('tool output\n中文');
              await api.details({ step: 2 }, context);
              await delay(16);
              return {};
            },
          }),
        ],
      }),
    );
    const harness = await Harness.open(
      new MemoryStorage(),
      {
        models,
        registry,
        settings: { progress: { partialIntervalMs: 1, outputIntervalMs: 1 } },
      },
      BACKGROUND_CONTEXT,
    );
    const conversation = await harness.root(BACKGROUND_CONTEXT, {
      agent: { model: { provider: model.provider, modelId: model.id } },
    });
    const watch = await conversation.watch(BACKGROUND_CONTEXT);
    let reconstructed = watch.value;
    const partials: AssistantMessage[] = [];
    const liveFrames: LiveState[] = [];
    let mismatches = 0;
    watch.start(async (view, ops) => {
      reconstructed = applyImmutable(reconstructed, ops);
      if (!isDeepStrictEqual(reconstructed, view)) mismatches++;
      const live = view.docs[LiveDoc.definition.kind] as LiveState | undefined;
      if (live) liveFrames.push(structuredClone(live));
      if (live?.generation?.message)
        partials.push(structuredClone(live.generation.message) as AssistantMessage);
    });
    try {
      const submitted = await conversation.submit(
        {
          type: 'input',
          content: 'Run the synthetic HTTP fixture.',
          requestId: 'anthropic-wire-fixture',
        },
        BACKGROUND_CONTEXT,
      );
      expect(await submitted.wait(BACKGROUND_CONTEXT)).toMatchObject({ status: 'done' });
      await vi.waitFor(() =>
        expect((watch.value.docs[LiveDoc.definition.kind] as LiveState).run).toBeUndefined(),
      );
      expect(requests).toHaveLength(2);
      expect(calls).toBe(1);
      expect(mismatches).toBe(0);
      for (const request of requests)
        expect(request).toMatchObject({ model: model.id, stream: true });
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
            (block) => block.type === 'text' && block.text === 'Reading a local ',
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
      expect(
        liveFrames.some((live) =>
          live.tools?.some(
            (tool) =>
              tool.status === 'running' &&
              tool.output === 'fixture ' &&
              isDeepStrictEqual(tool.details, { step: 1 }),
          ),
        ),
      ).toBe(true);
      const transcript = await conversation.context(BACKGROUND_CONTEXT);
      const tools = transcript.messages.filter((message) => message.role === 'toolResult');
      expect(tools).toHaveLength(1);
      expect(
        tools[0].content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join(''),
      ).toBe(Fixture.Output);
      const final = transcript.messages.at(-1);
      expect(final?.role).toBe('assistant');
      if (final?.role !== 'assistant') throw new Error('Missing terminal assistant message.');
      expect(final.stopReason).toBe('stop');
      expect(
        final.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join(''),
      ).toBe(Fixture.Final);
      expect(final.content.filter((block) => block.type === 'thinking')).toEqual([
        { type: 'thinking', thinking: Fixture.Reasoning, thinkingSignature: Fixture.Signature },
      ]);
      expect(requests[1].messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'assistant',
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'thinking',
                thinking: Fixture.Reasoning,
                signature: Fixture.Signature,
              }),
              expect.objectContaining({
                type: 'tool_use',
                id: 'toolu_fixture',
                name: Fixture.Tool,
                input: { text: Fixture.Arguments },
              }),
            ]),
          }),
          expect.objectContaining({
            role: 'user',
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'tool_result',
                tool_use_id: 'toolu_fixture',
                content: Fixture.Output,
              }),
            ]),
          }),
        ]),
      );
      expect(globalFetch).not.toHaveBeenCalled();
      expect(env).not.toHaveBeenCalled();
      expect(fileExists).not.toHaveBeenCalled();
    } finally {
      await watch.stop();
      await harness.close(BACKGROUND_CONTEXT);
      globalFetch.mockRestore();
    }
  });
});
