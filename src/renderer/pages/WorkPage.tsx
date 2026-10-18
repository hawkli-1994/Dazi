import { runtimeErrorText } from '../i18n/errors';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Button } from '../../shared/components/ui/button';
import { Title, Muted } from '../../shared/components/ui/typography';
import {
  Message,
  MessageContent,
  MessageResponse,
} from '../../shared/components/ai-elements/message';
import { Composer, DecisionView, Status, navigate } from '../components/common';
import { WorkContext } from '../components/WorkContext';
import { t, localize, type Language } from '../i18n';
import { demoStore, WorkStatus, MessageDelivery, MessageRole, type Work } from '../state';
import { AgentTranscript } from '../components/AgentTranscript';
import { isDesktop, runtimeClient } from '../runtime/client';
import { workActions } from '../runtime/actions';
export function WorkPage({ work, language }: { work: Work | undefined; language: Language }) {
  const native = isDesktop();
  const runtime = useSyncExternalStore(
    runtimeClient.subscribe,
    runtimeClient.getSnapshot,
    runtimeClient.getSnapshot,
  );
  const [actionError, setActionError] = useState('');
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    if (native && work?.id) void runtimeClient.openWork(work.id);
  }, [native, work?.id]);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1100px)').matches);
  const [showRecord, setShowRecord] = useState(
    () => !window.matchMedia('(max-width: 1100px)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1100px)');
    const update = () => {
      setNarrow(media.matches);
      setShowRecord(!media.matches);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const [confirmArchive, setConfirmArchive] = useState(false);
  if (!work)
    return (
      <main className="page page-narrow">
        <Title>{t(language, 'missingWork')}</Title>
        <Button className="mt-6" onClick={() => navigate('/')}>
          {t(language, 'back')}
        </Button>
      </main>
    );
  return (
    <main className="page work-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <Title>{localize(language, work.title)}</Title>
          <Muted className="mt-3">{localize(language, work.goal)}</Muted>
          <div className="flex flex-wrap gap-4 mt-3">
            <Status status={work.status} language={language} />
            <span className="muted">{work.directory}</span>
          </div>
        </div>
        <Button
          data-testid="work-record-toggle"
          aria-expanded={showRecord}
          aria-controls="work-record"
          onClick={() => setShowRecord(!showRecord)}
        >
          {t(language, showRecord ? 'hideDossier' : 'showDossier')}
        </Button>
      </div>
      <div className={showRecord && !narrow ? 'work-layout' : 'work-layout work-layout-single'}>
        <section className="conversation">
          {native ? (
            <AgentTranscript
              view={runtime.workId === work.id ? runtime.view : null}
              language={language}
              disconnected={!runtime.connected}
            />
          ) : work.messages.length ? (
            work.messages.map((message) => (
              <Message key={message.id} from={message.role}>
                <MessageContent>
                  <div className="message-label">
                    {t(language, message.role === MessageRole.User ? 'you' : 'assistantName')} ·{' '}
                    {t(
                      language,
                      message.delivery === MessageDelivery.Sample
                        ? 'sampleMessage'
                        : 'queuedMessage',
                    )}
                  </div>
                  <MessageResponse>{localize(language, message.content)}</MessageResponse>
                  {message.details && (
                    <details className="details">
                      <summary>{t(language, 'process')}</summary>
                      {message.details.map((detail, index) => (
                        <p className="muted" key={index}>
                          {localize(language, detail)}
                        </p>
                      ))}
                    </details>
                  )}
                </MessageContent>
              </Message>
            ))
          ) : (
            <div className="empty-state">
              <Muted>{t(language, 'noMessages')}</Muted>
            </div>
          )}
          {work.decisions.map((decision) => (
            <DecisionView
              key={decision.id}
              workId={work.id}
              decision={decision}
              readOnly={work.status === WorkStatus.Archived}
              language={language}
            />
          ))}
          <div role="status" className="flex items-center justify-between gap-4">
            {actionError && (
              <p className="error" role="alert">
                {actionError}
              </p>
            )}
            <p className={work.status === WorkStatus.Error ? 'error' : 'muted'}>
              {work.status === WorkStatus.Queued
                ? t(language, 'queuedNotice')
                : work.status === WorkStatus.Paused && !native
                  ? t(language, 'stoppedNotice')
                  : work.status === WorkStatus.Error && !native
                    ? t(language, 'networkError')
                    : localize(language, work.summary)}
            </p>
            {work.status === WorkStatus.Running ||
            work.status === WorkStatus.Queued ||
            (native && work.status === WorkStatus.Waiting) ? (
              <Button
                disabled={stopping}
                onClick={async () => {
                  setStopping(true);
                  setActionError('');
                  try {
                    await workActions.abort(work.id);
                  } catch (cause) {
                    setActionError(runtimeErrorText(language, cause));
                  } finally {
                    setStopping(false);
                  }
                }}
              >
                {t(language, 'stop')}
                {stopping ? '…' : ''}
              </Button>
            ) : !native &&
              (work.status === WorkStatus.Error || work.status === WorkStatus.Paused) ? (
              <Button onClick={() => demoStore.retry(work.id)}>{t(language, 'retry')}</Button>
            ) : null}
          </div>
          <div>
            <Composer
              draftKey={work.id}
              language={language}
              disabled={work.status === WorkStatus.Archived || (native && !runtime.connected)}
              onSubmit={(text) => workActions.submit(work.id, text)}
            />
            <Muted className="mt-3">
              {t(language, work.status === WorkStatus.Archived ? 'archivedComposer' : 'sendHint')}
            </Muted>
          </div>
          {work.status !== WorkStatus.Archived && (
            <div>
              {confirmArchive ? (
                <div className="flex gap-3">
                  <Button
                    variant="danger"
                    onClick={async () => {
                      try {
                        await workActions.archive(work.id);
                        setConfirmArchive(false);
                      } catch (cause) {
                        setActionError(runtimeErrorText(language, cause));
                      }
                    }}
                  >
                    {t(language, 'archive')}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmArchive(false)}>
                    {t(language, 'cancel')}
                  </Button>
                </div>
              ) : (
                <Button size="small" variant="ghost" onClick={() => setConfirmArchive(true)}>
                  {t(language, 'archive')}
                </Button>
              )}
            </div>
          )}
        </section>
        {showRecord && !narrow && <WorkContext key={work.id} work={work} language={language} />}
      </div>
      {narrow && (
        <Dialog.Root open={showRecord} onOpenChange={setShowRecord}>
          <Dialog.Portal>
            <Dialog.Backdrop className="drawer-backdrop" />
            <Dialog.Popup className="drawer">
              <div className="flex justify-between gap-4 items-center">
                <Dialog.Title className="section-title">{t(language, 'dossier')}</Dialog.Title>
                <Dialog.Close className="button button-secondary">
                  {t(language, 'close')}
                </Dialog.Close>
              </div>
              <Dialog.Description className="sr-only">
                {t(language, 'showDossier')}
              </Dialog.Description>
              <WorkContext key={work.id} work={work} language={language} />
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </main>
  );
}
