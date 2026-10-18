import { memo, useMemo } from 'react';
import type { ConversationView } from '@earendil-works/pi-durable';
import { ChevronRight } from 'lucide-react';
import { Message, MessageContent } from '../../shared/components/ai-elements/message';
import { agentText, type AgentLanguage } from '../i18n/agent';
import { AgentMarkdown, LocalImage } from './agent/AgentMarkdown';
import { JsonDetails, ToolBlock, ToolResult, UnmatchedTool } from './agent/ToolBlock';
import {
  ContentType,
  PiRole,
  StopReason,
  projectHistory,
  projectTranscript,
  type TranscriptRow,
} from './agent/projection';
import '../theme/agent.css';

export type AgentTranscriptProps = {
  view: ConversationView | null;
  language: AgentLanguage;
  disconnected: boolean;
};

const TranscriptEntry = memo(function TranscriptEntry({
  row,
  language,
  disconnected,
}: {
  row: TranscriptRow;
  language: AgentLanguage;
  disconnected: boolean;
}) {
  const { message } = row;
  if (row.attachedTo) return null;
  if (message.role === PiRole.ToolResult) {
    return (
      <details
        className="agent-disclosure"
        data-entry-id={row.entryId}
        data-model-index={row.modelIndex}
        data-call-id={message.toolCallId}
      >
        <summary className="agent-disclosure-summary">
          <ChevronRight className="agent-disclosure-chevron" aria-hidden="true" />
          <span className="agent-tool-name">{message.toolName}</span>
          <span className="agent-tool-status" data-state={message.isError ? 'error' : 'success'}>
            {agentText(language, message.isError ? 'error' : 'success')}
          </span>
        </summary>
        <div className="agent-disclosure-content">
          <ToolResult result={message} language={language} />
        </div>
      </details>
    );
  }
  const assistant = message.role === PiRole.Assistant;
  return (
    <Message
      from={message.role}
      className="agent-message"
      data-entry-id={row.entryId}
      data-model-index={row.modelIndex}
      data-live={row.live || undefined}
    >
      <MessageContent>
        <p className="message-label">{agentText(language, assistant ? 'assistant' : 'you')}</p>
        {typeof message.content === 'string' ? (
          <div className="agent-user-text">{message.content}</div>
        ) : (
          message.content.map((content, contentIndex) => {
            const key = `${row.key}:content:${contentIndex}`;
            if (content.type === ContentType.Text) {
              return (
                <div key={key} data-content-index={contentIndex}>
                  <AgentMarkdown language={language} streaming={row.live}>
                    {content.text}
                  </AgentMarkdown>
                </div>
              );
            }
            if (content.type === ContentType.Image)
              return <LocalImage key={key} content={content} language={language} />;
            if (content.type === ContentType.Thinking) {
              // Only provider-published ThinkingContent is shown. Opaque signatures never enter the DOM.
              return (
                <details
                  key={key}
                  className="agent-disclosure agent-reasoning"
                  data-content-index={contentIndex}
                >
                  <summary className="agent-disclosure-summary">
                    <ChevronRight className="agent-disclosure-chevron" aria-hidden="true" />
                    {agentText(language, 'reasoning')}
                  </summary>
                  <div className="agent-disclosure-content">
                    <p className="agent-note">{agentText(language, 'reasoningHint')}</p>
                    {content.redacted ? (
                      <p className="agent-note">{agentText(language, 'reasoningRedacted')}</p>
                    ) : (
                      <AgentMarkdown language={language} streaming={row.live}>
                        {content.thinking}
                      </AgentMarkdown>
                    )}
                  </div>
                </details>
              );
            }
            const tool = row.tools.get(contentIndex);
            return tool ? (
              <ToolBlock key={key} tool={tool} language={language} disconnected={disconnected} />
            ) : null;
          })
        )}
        {assistant &&
          !row.live &&
          [StopReason.Error, StopReason.Aborted, StopReason.Length].some(
            (reason) => reason === message.stopReason,
          ) && (
            <div className="agent-response-notice">
              <p className="agent-note">
                {agentText(
                  language,
                  message.stopReason === StopReason.Error
                    ? 'responseError'
                    : message.stopReason === StopReason.Aborted
                      ? 'responseAborted'
                      : 'responseLength',
                )}
              </p>
              {message.errorMessage && (
                <details className="agent-disclosure">
                  <summary>{agentText(language, 'details')}</summary>
                  <pre className="agent-code">{message.errorMessage}</pre>
                </details>
              )}
            </div>
          )}
      </MessageContent>
    </Message>
  );
});

export function AgentTranscript({ view, language, disconnected }: AgentTranscriptProps) {
  const entries = view?.entries;
  const history = useMemo(() => (entries ? projectHistory(entries) : null), [entries]);
  const projection = useMemo(
    () => (view && history ? projectTranscript(view, history) : null),
    [view, history],
  );
  const live = projection?.live;
  return (
    <section className="agent-transcript" aria-label={agentText(language, 'transcript')}>
      {disconnected && (
        <p className="agent-note agent-connection-notice" role="status">
          {agentText(language, 'disconnected')}
        </p>
      )}
      {!projection ? (
        <p className="agent-note" role="status">
          {agentText(language, 'loading')}
        </p>
      ) : (
        <>
          {!projection.rows.length && !live?.run && (
            <p className="agent-note">{agentText(language, 'empty')}</p>
          )}
          {projection.rows.map((row) => (
            <TranscriptEntry
              key={row.key}
              row={row}
              language={language}
              disconnected={disconnected}
            />
          ))}
          {projection.unmatchedTools.map((slot) => (
            <UnmatchedTool
              key={`${slot.callId}:${slot.taskId ?? ''}`}
              slot={slot}
              language={language}
              disconnected={disconnected}
            />
          ))}
          {live?.generation?.retry && (
            <details className="agent-disclosure">
              <summary>{agentText(language, 'retry')}</summary>
              <pre className="agent-code">{live.generation.retry.error}</pre>
            </details>
          )}
          {live?.generation?.deferred && (
            <p className="agent-note" role="status">
              {agentText(language, 'deferred')}
            </p>
          )}
          {Boolean(live?.compactions?.length) && (
            <p className="agent-note" role="status">
              {agentText(language, 'compaction')}
            </p>
          )}
          {live?.compactionFailure && (
            <details className="agent-disclosure">
              <summary>{agentText(language, 'compactionFailed')}</summary>
              <JsonDetails value={{ error: live.compactionFailure.error }} />
            </details>
          )}
        </>
      )}
    </section>
  );
}
