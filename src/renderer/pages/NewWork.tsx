import { runtimeErrorText } from '../i18n/errors';
import { useRef, useState } from 'react';
import { Button } from '../../shared/components/ui/button';
import { Title, Muted } from '../../shared/components/ui/typography';
import { t, type Language } from '../i18n';
import { workActions } from '../runtime/actions';
import { rt } from '../i18n/runtime';
import { isDesktop } from '../runtime/client';
import { navigate } from '../components/common';
export function NewWork({ language, initialGoal }: { language: Language; initialGoal: string }) {
  const [goal, setGoal] = useState(initialGoal);
  const [directory, setDirectory] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  return (
    <main className="page page-narrow">
      <Title>{t(language, 'createWorkTitle')}</Title>
      <Muted className="mt-3">{t(language, 'createWorkDescription')}</Muted>
      <form
        className="flex flex-col gap-8 mt-12"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          if (!goal.trim()) {
            setError(t(language, 'goalRequired'));
            return;
          }
          if (!directory.trim()) {
            setError(t(language, 'directoryRequired'));
            return;
          }
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            navigate(
              `/work/${await workActions.createWork(goal.trim(), directory.trim(), requestId.current)}`,
            );
          } catch (cause) {
            setError(runtimeErrorText(language, cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label htmlFor="goal">{t(language, 'workGoal')}</label>
          <textarea
            className="input"
            id="goal"
            data-testid="new-work-goal"
            disabled={busy}
            value={goal}
            onChange={(event) => {
              setGoal(event.target.value);
              requestId.current = crypto.randomUUID();
            }}
            placeholder={t(language, 'workGoalPlaceholder')}
            required
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="directory">{t(language, 'workDirectory')}</label>
          <input
            className="input"
            id="directory"
            data-testid="new-work-directory"
            disabled={busy}
            value={directory}
            onChange={(event) => {
              setDirectory(event.target.value);
              requestId.current = crypto.randomUUID();
            }}
            placeholder={t(language, 'workDirectoryPlaceholder')}
            required
            aria-describedby="directory-hint"
          />
          {isDesktop() && (
            <Button
              disabled={busy}
              onClick={async () => {
                const path = await window.daziDesktop?.selectFolder();
                if (path) {
                  setDirectory(path);
                  requestId.current = crypto.randomUUID();
                }
              }}
            >
              {rt(language, 'chooseFolder')}
            </Button>
          )}
          <p className="field-hint" id="directory-hint">
            {t(language, 'workDirectoryHint')}
          </p>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <Button type="submit" variant="primary" data-testid="create-work" disabled={busy}>
            {t(language, 'createWorkAction')}
          </Button>
          <Button disabled={busy} variant="ghost" onClick={() => navigate('/')}>
            {t(language, 'cancel')}
          </Button>
        </div>
      </form>
    </main>
  );
}
