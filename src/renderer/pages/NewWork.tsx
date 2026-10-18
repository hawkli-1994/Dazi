import { useState } from 'react';
import { Button } from '../../shared/components/ui/button';
import { Title, Muted } from '../../shared/components/ui/typography';
import { t, type Language } from '../i18n';
import { demoStore } from '../state';
import { navigate } from '../components/common';
export function NewWork({ language, initialGoal }: { language: Language; initialGoal: string }) {
  const [goal, setGoal] = useState(initialGoal);
  const [directory, setDirectory] = useState('');
  const [error, setError] = useState('');
  return (
    <main className="page page-narrow">
      <Title>{t(language, 'createWorkTitle')}</Title>
      <Muted className="mt-3">{t(language, 'createWorkDescription')}</Muted>
      <form
        className="flex flex-col gap-8 mt-12"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!goal.trim()) {
            setError(t(language, 'goalRequired'));
            return;
          }
          if (!directory.trim()) {
            setError(t(language, 'directoryRequired'));
            return;
          }
          navigate(`/work/${demoStore.createWork(goal.trim(), directory.trim())}`);
        }}
      >
        <div className="field">
          <label htmlFor="goal">{t(language, 'workGoal')}</label>
          <textarea
            className="input"
            id="goal"
            data-testid="new-work-goal"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
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
            value={directory}
            onChange={(event) => setDirectory(event.target.value)}
            placeholder={t(language, 'workDirectoryPlaceholder')}
            required
            aria-describedby="directory-hint"
          />
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
          <Button type="submit" variant="primary" data-testid="create-work">
            {t(language, 'createWorkAction')}
          </Button>
          <Button variant="ghost" onClick={() => navigate('/')}>
            {t(language, 'cancel')}
          </Button>
        </div>
      </form>
    </main>
  );
}
