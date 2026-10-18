import type { Language } from './index';

const copy = {
  invalidInput: {
    zh: '有些填写内容无法使用，这次操作没有完成。请检查必填项、时间和文字长度后重试。',
    en: 'Some input could not be used, so the operation did not complete. Check required fields, time and text length, then try again.',
  },
  workMissing: {
    zh: '找不到这项工作，暂时无法继续。请返回今日简报，重新打开工作。',
    en: 'This work could not be found. Return to the briefing and open the work again.',
  },
  archived: {
    zh: '这项工作已归档，不能继续修改或执行。请查看已有结果，或新建一项工作。',
    en: 'This work is archived and cannot be changed or run. Review its saved results or start a new work item.',
  },
  directory: {
    zh: '无法使用这个工作目录，这次工作尚未创建。请重新选择本机可访问的文件夹。',
    en: 'The work folder could not be used, so the work was not created. Choose an accessible folder on this computer.',
  },
  modelMissing: {
    zh: '还没有可用的模型，这次工作无法开始。请到能力页选择已配置好的模型后重试。',
    en: 'No model is ready, so this work cannot start. Choose a configured model in Capabilities, then try again.',
  },
  modelUnavailable: {
    zh: '所选模型目前不可用，设置未保存。请到能力页重新选择可用的模型。',
    en: 'The selected model is unavailable and the setting was not saved. Choose an available model in Capabilities.',
  },
  credentials: {
    zh: '模型凭据尚未配置，这次工作无法开始。请按能力页说明在本机配置凭据，然后重启应用。',
    en: 'Model credentials are not configured, so this work cannot start. Follow the instructions in Capabilities to configure credentials locally, then restart the app.',
  },
  decision: {
    zh: '这项决定已经处理或不再等待确认，没有再次执行。请查看最新进展。',
    en: 'This decision was already handled or is no longer awaiting approval. It was not run again. Review the latest progress.',
  },
  noteMissing: {
    zh: '这条档案记录已不可用，修改未保存。请重新打开工作档案后再试。',
    en: 'This work note is no longer available and the change was not saved. Reopen the work notes and try again.',
  },
  disconnected: {
    zh: '与工作进程的连接已断开，暂时无法确认最新进展。请等待重新连接后再操作。',
    en: 'The connection to the work process was lost, so the latest progress cannot be confirmed. Wait for reconnection before continuing.',
  },
  uncertain: {
    zh: '还没收到操作确认，工作可能已开始。连接恢复后先查看进展；重试消息时请保留原文。',
    en: 'Confirmation has not arrived; the work may already have started. Check progress after reconnecting. If you retry a message, use exactly the same text.',
  },
  openFailed: {
    zh: '暂时无法读取这项工作。请返回今日简报，重新打开工作。',
    en: 'This work could not be loaded. Return to the briefing and open it again.',
  },
  processStopped: {
    zh: '工作进程未能重新启动，暂时无法继续操作。请重启应用，再查看已保存的进展。',
    en: 'The work process could not restart, so further actions are unavailable. Restart the app and review saved progress.',
  },
  stopped: {
    zh: '这次执行已停止，已收到的内容仍保留。需要继续时，请交代下一步。',
    en: 'This run was stopped and the content received so far is kept. Share the next step when you want to continue.',
  },
  responseFailed: {
    zh: '这次回复未能完成，已收到的内容仍保留。请检查连接和能力页中的模型设置，再尝试继续。',
    en: 'This reply did not finish; content received so far is kept. Check the connection and model settings in Capabilities, then try continuing.',
  },
  contextChanged: {
    zh: '工作内容已变更，这条消息未能继续处理。请查看当前对话，再交代下一步。',
    en: 'The work context changed before this message could be completed. Review the current conversation and share the next step.',
  },
  interrupted: {
    zh: '这次执行意外中断，无法确认是否完成。请先查看已保存的进展，再决定下一步。',
    en: 'This run was interrupted unexpectedly and completion could not be confirmed. Review saved progress before deciding the next step.',
  },
  generic: {
    zh: '这次操作未能确认完成。请先查看当前进展，稍后再试。',
    en: 'This operation could not be confirmed as complete. Review the current progress before trying again.',
  },
} as const;

type ErrorKey = keyof typeof copy;
// Exact known wire errors only. Do not pattern-match or reflect arbitrary provider messages.
// Kept at the renderer boundary so the host and native transport remain language-neutral.
const knownErrors = new Map<string, ErrorKey>([
  ['INVALID_INPUT', 'invalidInput'],
  ['WORK_NOT_FOUND', 'workMissing'],
  ['WORK_ARCHIVED', 'archived'],
  ['DIRECTORY_INVALID', 'directory'],
  ['MODEL_NOT_CONFIGURED', 'modelMissing'],
  ['MODEL_NOT_AVAILABLE', 'modelUnavailable'],
  ['MODEL_AUTH_MISSING', 'credentials'],
  ['DECISION_NOT_PENDING', 'decision'],
  ['NOTE_NOT_FOUND', 'noteMissing'],
  ['HOST_OPERATION_FAILED', 'generic'],
  ['CONNECTION_CLOSED', 'disconnected'],
  ['Connection interrupted. Reconnect to continue.', 'disconnected'],
  ['Connection lost before confirmation. Retry with the same request ID.', 'uncertain'],
  ['The desktop host is disconnected.', 'disconnected'],
  ['Confirmation timed out. The work may still be running.', 'uncertain'],
  ['Unable to open work.', 'openFailed'],
  ['The desktop host could not restart.', 'processStopped'],
  ['The run stopped: aborted', 'stopped'],
  ['The run stopped: no_model', 'modelMissing'],
  ['The run stopped: model_error', 'responseFailed'],
  ['The run stopped: reset', 'contextChanged'],
  ['The run stopped: stale', 'contextChanged'],
  ['The run stopped: faulted', 'interrupted'],
  ['The run stopped: orphaned', 'interrupted'],
]);

/** Never interpolate raw exceptions, filesystem paths, provider responses, or credentials. */
export function runtimeErrorText(language: Language, error: unknown): string {
  const code = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  return copy[knownErrors.get(code) ?? 'generic'][language];
}
