import { setTimeout as delay } from 'node:timers/promises';
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxThinking,
  fauxText,
  fauxToolCall,
  Type,
  type FauxResponseFactory,
} from '@earendil-works/pi-ai';
import { defineExtension, defineTool } from '@earendil-works/pi-durable';

export const TestModel = { provider: 'faux', modelId: 'faux-1' } as const;
export const TestToolName = 'dazi_test_progress';

/** Explicit CLI-only fixture. Never registered in an ordinary production Host. */
export function createTestProvider() {
  const faux = fauxProvider({ tokensPerSecond: 180, tokenSize: { min: 1, max: 1 } });
  const respond: FauxResponseFactory = (transcript) => {
    faux.appendResponses([respond]);
    const lastUser = [...transcript.messages].reverse().find((message) => message.role === 'user');
    const text =
      typeof lastUser?.content === 'string'
        ? lastUser.content
        : (lastUser?.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('') ?? '');
    const last = transcript.messages.at(-1);
    if (text.includes('[test:tool]') && last?.role !== 'toolResult') {
      return fauxAssistantMessage(
        [
          fauxThinking(
            'This is deterministic test-provider reasoning. '.repeat(
              text.includes('[test:visual]') ? 6 : 1,
            ),
          ),
          fauxText('Running a local fixture tool. '),
          fauxToolCall(TestToolName, {
            text: 'test output',
            ...(text.includes('[test:visual]') ? { delayMs: 1000 } : {}),
          }),
        ],
        { stopReason: 'toolUse' },
      );
    }
    const output = text.includes('[test:slow]')
      ? 'Deterministic recoverable stream. '.repeat(60)
      : 'Test provider completed this local runtime check. No real model or network was used.';
    return fauxAssistantMessage([
      fauxThinking('Checking the local test fixture. '),
      fauxText(output),
    ]);
  };
  faux.setResponses([respond]);
  return faux;
}

export const TestTools = defineExtension({
  name: 'dazi.test-only',
  tools: [
    defineTool({
      name: TestToolName,
      description: 'Deterministic in-memory test output only',
      replay: 'safe',
      parameters: Type.Object({
        text: Type.String(),
        delayMs: Type.Optional(Type.Number({ minimum: 1, maximum: 1000 })),
      }),
      execute: async (args, api, context) => {
        for (let index = 0; index < 3; index++) {
          api.output(`${args.text} ${index + 1}\n`);
          await api.details({ step: index + 1 }, context);
          await delay(Math.min(1000, Math.max(1, args.delayMs ?? 60)), undefined, {
            signal: context.abortSignal,
          });
        }
        return {};
      },
    }),
  ],
});
