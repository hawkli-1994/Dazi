import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { Type } from '@earendil-works/pi-ai';
import {
  defineExtension,
  defineTool,
  section,
  type ToolExecutionApi,
  type Tx,
} from '@earendil-works/pi-durable';
import { ArtifactsDoc, DossierDoc, PlanDoc, PlanStatus, WorkDoc } from './documents';

async function sourceEntry(tx: Tx, api: ToolExecutionApi): Promise<string> {
  const input = (await tx.task(api.taskId))?.input;
  return input &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    input.kind === 'model' &&
    typeof input.assistant === 'number'
    ? String(input.assistant)
    : '';
}

/** Optional conveniences; completion never depends on calling a bookkeeping tool. */
export const WorkMemory = defineExtension({
  name: 'dazi.work-memory',
  sections: [
    section('dazi_context', async (input, context) => {
      const work = await input.read.snapshot(WorkDoc, input.conversationId, context);
      const dossier = await input.read.snapshot(DossierDoc, input.conversationId, context);
      return [
        'You are Dazi, a practical work partner. Lead with results and ask only when a decision is needed.',
        'Use the work directory. Do not claim a tool action succeeded before its result. Reasoning visibility depends on the provider; do not fabricate it.',
        'Work notes, plans, and deliverables tools are optional. Never call them merely to satisfy a completion protocol.',
        work ? `Goal: ${work.goal}\nWork directory: ${work.directory}` : '',
        dossier?.notes.length
          ? `Working context:\n${dossier.notes
              .map((note) => note.text)
              .join('\n')
              .slice(0, 6000)}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
    }),
  ],
  tools: [
    defineTool({
      name: 'remember_work',
      description: 'Optionally record an important agreement or correction for this work.',
      replay: 'safe',
      parameters: Type.Object({
        text: Type.String({ minLength: 1, maxLength: 4000 }),
        id: Type.Optional(Type.String({ maxLength: 80 })),
      }),
      execute: async (args, api, context) => {
        await api.commit(async (tx) => {
          const sourceEntryId = await sourceEntry(tx, api);
          const dossier = await tx.doc(DossierDoc, api.conversationId);
          const id = args.id || api.callId;
          const existing = dossier.notes.find((note) => note.id === id);
          if (existing) Object.assign(existing, { text: args.text, sourceEntryId });
          else dossier.notes.push({ id, text: args.text, sourceEntryId });
        }, context);
        return { output: [{ type: 'text', text: 'Work note saved.' }] };
      },
    }),
    defineTool({
      name: 'set_work_plan',
      description: 'Optionally maintain a short, concrete next-step plan for this work.',
      replay: 'safe',
      parameters: Type.Object({
        items: Type.Array(
          Type.Object({
            id: Type.String({ minLength: 1, maxLength: 80 }),
            title: Type.String({ minLength: 1, maxLength: 500 }),
            status: Type.Union([
              Type.Literal(PlanStatus.Pending),
              Type.Literal(PlanStatus.InProgress),
              Type.Literal(PlanStatus.Done),
            ]),
          }),
          { maxItems: 30 },
        ),
      }),
      execute: async (args, api, context) => {
        await api.commit(async (tx) => {
          (await tx.doc(PlanDoc, api.conversationId)).items = args.items;
        }, context);
        return { output: [{ type: 'text', text: 'Work plan saved.' }] };
      },
    }),
    defineTool({
      name: 'declare_artifact',
      description: 'Optionally list an existing file in the work directory as a deliverable.',
      replay: 'safe',
      parameters: Type.Object({
        title: Type.String({ minLength: 1, maxLength: 200 }),
        path: Type.String({ minLength: 1, maxLength: 1000 }),
      }),
      execute: async (args, api, context) => {
        const work = await api.snapshot(WorkDoc, api.conversationId, context);
        if (!work) throw new Error('Work directory is unavailable.');
        const root = await realpath(work.directory);
        const path = await realpath(resolve(root, args.path));
        const within = relative(root, path);
        if (
          isAbsolute(within) ||
          within === '..' ||
          within.startsWith('../') ||
          within.startsWith('..\\') ||
          !(await stat(path)).isFile()
        ) {
          throw new Error('Deliverables must be files inside the work directory.');
        }
        await api.commit(async (tx) => {
          const sourceEntryId = await sourceEntry(tx, api);
          const artifacts = await tx.doc(ArtifactsDoc, api.conversationId);
          const existing = artifacts.items.find((item) => item.path === path);
          if (existing) Object.assign(existing, { title: args.title, sourceEntryId });
          else artifacts.items.push({ id: api.callId, title: args.title, path, sourceEntryId });
        }, context);
        return { output: [{ type: 'text', text: 'Existing deliverable added.' }] };
      },
    }),
  ],
});
