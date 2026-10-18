import { useState } from 'react';
import { ArrowUpRight, Send, Circle, Check, AlertCircle, Pause, Clock } from 'lucide-react';
import { Button } from '../../shared/components/ui/button';
import { t, localize, type Language, type TranslationKey } from '../i18n';
import { WorkStatus, DecisionStatus, type Decision } from '../state';
import { workActions } from '../runtime/actions';
import { isDesktop } from '../runtime/client';
export function navigate(path: string) {
  window.location.hash = path;
}
export function Status({ status, language }: { status: WorkStatus; language: Language }) {
  const keys: Record<WorkStatus, TranslationKey> = {
    running: 'statusRunning',
    waiting: 'statusWaiting',
    error: 'statusError',
    done: 'statusDone',
    queued: 'statusQueued',
    paused: 'statusPaused',
    archived: 'statusArchived',
  };
  const Icon =
    status === WorkStatus.Done
      ? Check
      : status === WorkStatus.Error
        ? AlertCircle
        : status === WorkStatus.Paused
          ? Pause
          : status === WorkStatus.Queued
            ? Clock
            : Circle;
  return (
    <span className={`status status-${status}`}>
      <Icon aria-hidden="true" />
      {t(language, keys[status])}
    </span>
  );
}
const drafts = new Map<string, string>();
export function clearDrafts() {
  drafts.clear();
}
export function Composer({
  language,
  onSubmit,
  welcome = false,
  disabled = false,
  draftKey = 'welcome',
}: {
  language: Language;
  onSubmit: (value: string) => void | Promise<unknown>;
  welcome?: boolean;
  disabled?: boolean;
  draftKey?: string;
}) {
  const [value, setValue] = useState(() => drafts.get(draftKey) ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    if (!value.trim() || disabled || sending) return;
    setSending(true);
    setError('');
    try {
      await onSubmit(value.trim());
      drafts.delete(draftKey);
      setValue('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t(language, 'networkError'));
    } finally {
      setSending(false);
    }
  }
  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <textarea
        data-testid="work-composer"
        rows={1}
        aria-label={t(language, welcome ? 'welcomePlaceholder' : 'composerPlaceholder')}
        placeholder={t(language, welcome ? 'welcomePlaceholder' : 'composerPlaceholder')}
        value={value}
        disabled={disabled || sending}
        onChange={(event) => {
          setValue(event.target.value);
          drafts.set(draftKey, event.target.value);
        }}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            event.nativeEvent.keyCode !== 229
          ) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <Button
        variant="primary"
        size="icon"
        type="submit"
        data-testid="send-message"
        aria-label={t(language, 'send')}
        disabled={disabled || sending || !value.trim()}
      >
        <Send aria-hidden="true" />
      </Button>
    </form>
  );
}
export function OpenWork({ id, language }: { id: string; language: Language }) {
  return (
    <Button variant="ghost" size="small" onClick={() => navigate(`/work/${id}`)}>
      {t(language, 'openWork')}
      <ArrowUpRight aria-hidden="true" />
    </Button>
  );
}
export function DecisionView({
  workId,
  decision,
  language,
  readOnly = false,
}: {
  workId: string;
  decision: Decision;
  language: Language;
  readOnly?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function decide(result: typeof DecisionStatus.Approved | typeof DecisionStatus.Declined) {
    setBusy(true);
    setError('');
    try {
      await workActions.resolveDecision(workId, decision.id, result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t(language, 'networkError'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="decision" data-testid="decision">
      <h3>{localize(language, decision.title)}</h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {decision.status === DecisionStatus.Pending ? (
        <>
          <p className="reading">{localize(language, decision.reason)}</p>
          <p className="muted mt-3">
            {t(language, 'decisionImpact')} · {localize(language, decision.impact)}
          </p>
          <details className="details">
            <summary>{t(language, 'decisionPreview')}</summary>
            <pre className="preview">{localize(language, decision.preview)}</pre>
          </details>
          {!isDesktop() && <p className="field-hint my-4">{t(language, 'decisionDemoHint')}</p>}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="attention"
              disabled={readOnly || busy}
              onClick={() => decide(DecisionStatus.Approved)}
            >
              {localize(language, decision.approveLabel)}
            </Button>
            <Button
              variant="ghost"
              disabled={readOnly || busy}
              onClick={() => decide(DecisionStatus.Declined)}
            >
              {t(language, 'decline')}
            </Button>
          </div>
        </>
      ) : (
        <p role="status" className="muted">
          {decision.result
            ? localize(language, decision.result)
            : t(
                language,
                decision.status === DecisionStatus.Approved
                  ? 'decisionApproved'
                  : 'decisionDeclined',
              )}
        </p>
      )}
    </section>
  );
}
