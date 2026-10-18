import { memo } from 'react';
import { ChevronRight, Check, Circle, CircleAlert, Minus } from 'lucide-react';
import type { ToolResultMessage } from '@earendil-works/pi-ai';
import type { ToolSlot } from '@earendil-works/pi-durable';
import { agentText, type AgentLanguage } from '../../i18n/agent';
import { LocalImage } from './AgentMarkdown';
import {
  ContentType,
  ToolStatus,
  nestedToolStatus,
  toolStatus,
  type NestedToolProjection,
  type ToolProjection,
} from './projection';

export const JsonDetails = memo(function JsonDetails({ value }: { value: unknown }) {
  return (
    <pre className="agent-code" tabIndex={0}>
      <code>{JSON.stringify(value, null, 2)}</code>
    </pre>
  );
});

function StatusIcon({ status }: { status: ToolStatus }) {
  if (status === ToolStatus.Success) return <Check aria-hidden="true" />;
  if (status === ToolStatus.Error || status === ToolStatus.Interrupted)
    return <CircleAlert aria-hidden="true" />;
  if (status === ToolStatus.Unknown || status === ToolStatus.Missing)
    return <Minus aria-hidden="true" />;
  return <Circle aria-hidden="true" />;
}

function ToolSummary({
  name,
  status,
  language,
  disconnected,
}: {
  name: string;
  status: ToolStatus;
  language: AgentLanguage;
  disconnected: boolean;
}) {
  const stale =
    disconnected &&
    [ToolStatus.Input, ToolStatus.Pending, ToolStatus.Running].some((value) => value === status);
  return (
    <summary className="agent-disclosure-summary">
      <ChevronRight className="agent-disclosure-chevron" aria-hidden="true" />
      <span className="agent-tool-name">{name}</span>
      <span className="agent-tool-status" data-state={status}>
        <StatusIcon status={status} />
        {stale ? agentText(language, 'lastKnown') : ''}
        {agentText(language, status)}
      </span>
    </summary>
  );
}

function Progress({ slot, language }: { slot: ToolSlot; language: AgentLanguage }) {
  return (
    <>
      {slot.output !== undefined && (
        <section className="agent-detail-section">
          <p className="agent-detail-label">{agentText(language, 'output')}</p>
          <pre className="agent-code" tabIndex={0}>
            {slot.output}
          </pre>
        </section>
      )}
      {Boolean(slot.droppedBytes || slot.droppedLines) && (
        <p className="agent-note">{agentText(language, 'outputTruncated')}</p>
      )}
      {slot.details !== undefined && (
        <section className="agent-detail-section">
          <p className="agent-detail-label">{agentText(language, 'details')}</p>
          <JsonDetails value={slot.details} />
        </section>
      )}
      {Boolean(slot.diagnostics?.length) && <JsonDetails value={slot.diagnostics} />}
    </>
  );
}

export const ToolResult = memo(function ToolResult({
  result,
  language,
}: {
  result: ToolResultMessage;
  language: AgentLanguage;
}) {
  return (
    <>
      <section className="agent-detail-section">
        <p className="agent-detail-label">{agentText(language, 'result')}</p>
        {result.content.map((content, index) =>
          content.type === ContentType.Text ? (
            <pre key={index} className="agent-code" tabIndex={0}>
              <code>{content.text}</code>
            </pre>
          ) : (
            <LocalImage key={index} content={content} language={language} />
          ),
        )}
      </section>
      {result.details !== undefined && (
        <section className="agent-detail-section">
          <p className="agent-detail-label">{agentText(language, 'details')}</p>
          <JsonDetails value={result.details} />
        </section>
      )}
      {result.nestedCalls && (
        <section className="agent-detail-section">
          <p className="agent-detail-label">{agentText(language, 'nestedCalls')}</p>
          {result.nestedCalls.calls.map((call) => (
            <details className="agent-disclosure" key={call.id} data-call-id={call.id}>
              <ToolSummary
                name={call.name}
                status={
                  call.status === 'ok'
                    ? ToolStatus.Success
                    : call.status === 'error'
                      ? ToolStatus.Error
                      : ToolStatus.Interrupted
                }
                language={language}
                disconnected={false}
              />
              <div className="agent-disclosure-content">
                {call.arguments !== undefined && <JsonDetails value={call.arguments} />}
                {call.error && <pre className="agent-code">{call.error}</pre>}
              </div>
            </details>
          ))}
          {!result.nestedCalls.complete && (
            <p className="agent-note">{agentText(language, 'nestedIncomplete')}</p>
          )}
        </section>
      )}
    </>
  );
});

function NestedTool({
  tool,
  language,
  disconnected,
}: {
  tool: NestedToolProjection;
  language: AgentLanguage;
  disconnected: boolean;
}) {
  const status = nestedToolStatus(tool.slot);
  return (
    <details
      className="agent-disclosure"
      data-call-id={tool.slot.callId}
      data-task-id={tool.slot.taskId}
    >
      <ToolSummary
        name={tool.slot.name}
        status={status}
        language={language}
        disconnected={disconnected}
      />
      <div className="agent-disclosure-content">
        <p className="agent-detail-label">{agentText(language, 'arguments')}</p>
        <JsonDetails value={tool.slot.arguments} />
        <Progress slot={tool.slot} language={language} />
        {tool.slot.summary?.error && <pre className="agent-code">{tool.slot.summary.error}</pre>}
        {status === ToolStatus.Interrupted && (
          <p className="agent-note">{agentText(language, 'noSavedResult')}</p>
        )}
        {tool.children.map((child) => (
          <NestedTool
            key={child.slot.taskId}
            tool={child}
            language={language}
            disconnected={disconnected}
          />
        ))}
      </div>
    </details>
  );
}

export function ToolBlock({
  tool,
  language,
  disconnected,
}: {
  tool: ToolProjection;
  language: AgentLanguage;
  disconnected: boolean;
}) {
  const status = toolStatus(tool);
  return (
    <details
      className="agent-disclosure agent-tool"
      data-call-id={tool.call.id}
      data-task-id={tool.slot?.taskId}
      data-content-index={tool.contentIndex}
      data-result-entry-id={tool.result?.entryId}
    >
      <ToolSummary
        name={tool.call.name}
        status={status}
        language={language}
        disconnected={disconnected}
      />
      <div className="agent-disclosure-content">
        <section className="agent-detail-section">
          <p className="agent-detail-label">{agentText(language, 'arguments')}</p>
          <JsonDetails value={tool.call.arguments} />
          {tool.call.argumentsError && (
            <>
              <p className="agent-note">{agentText(language, 'argumentsError')}</p>
              <pre className="agent-code">{tool.call.argumentsError}</pre>
            </>
          )}
        </section>
        {tool.result ? (
          <ToolResult result={tool.result.message} language={language} />
        ) : (
          tool.slot && <Progress slot={tool.slot} language={language} />
        )}
        {status === ToolStatus.Interrupted && (
          <p className="agent-note">{agentText(language, 'noSavedResult')}</p>
        )}
        {status === ToolStatus.Missing && (
          <p className="agent-note">{agentText(language, 'resultUnavailable')}</p>
        )}
        {tool.nested.map((nested) => (
          <NestedTool
            key={nested.slot.taskId}
            tool={nested}
            language={language}
            disconnected={disconnected}
          />
        ))}
      </div>
    </details>
  );
}

export function UnmatchedTool({
  slot,
  language,
  disconnected,
}: {
  slot: ToolSlot;
  language: AgentLanguage;
  disconnected: boolean;
}) {
  const status = toolStatus({ slot, inputStreaming: false });
  return (
    <details className="agent-disclosure" data-call-id={slot.callId} data-task-id={slot.taskId}>
      <ToolSummary
        name={slot.name}
        status={status}
        language={language}
        disconnected={disconnected}
      />
      <div className="agent-disclosure-content">
        <Progress slot={slot} language={language} />
        <p className="agent-note">
          {agentText(
            language,
            status === ToolStatus.Interrupted ? 'noSavedResult' : 'resultUnavailable',
          )}
        </p>
      </div>
    </details>
  );
}
