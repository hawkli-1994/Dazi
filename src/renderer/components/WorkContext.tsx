import { useState } from 'react';
import { Button } from '../../shared/components/ui/button';
import { Muted } from '../../shared/components/ui/typography';
import { t, localize, type Language, type TranslationKey } from '../i18n';
import { demoStore, WorkStatus, ScheduleFrequency, type Work, type DossierEntry } from '../state';
const Tab = {
  Dossier: 'dossier',
  Artifacts: 'artifacts',
  Plan: 'plan',
  Schedule: 'schedule',
} as const;
function DossierRow({
  entry,
  work,
  language,
}: {
  entry: DossierEntry;
  work: Work;
  language: Language;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(localize(language, entry.content));
  return (
    <div className="context-item">
      {editing && work.status !== WorkStatus.Archived ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim()) {
              if (
                demoStore.updateDossier(work.id, entry.id, value) ||
                localize(language, entry.content) === value.trim()
              )
                setEditing(false);
            }
          }}
        >
          <label className="field">
            <span>{t(language, 'editDossier')}</span>
            <textarea
              className="input"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              required
            />
          </label>
          <div className="flex gap-2">
            <Button size="small" type="submit">
              {t(language, 'save')}
            </Button>
            <Button size="small" variant="ghost" onClick={() => setEditing(false)}>
              {t(language, 'cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p className="reading">{localize(language, entry.content)}</p>
          <Muted className="mt-2">
            {t(language, 'dossierSource')} · {localize(language, entry.source)}
          </Muted>
          <Button
            size="small"
            variant="ghost"
            disabled={work.status === WorkStatus.Archived}
            onClick={() => {
              setValue(localize(language, entry.content));
              setEditing(true);
            }}
          >
            {t(language, 'edit')}
          </Button>
        </>
      )}
    </div>
  );
}
function Schedule({ work, language }: { work: Work; language: Language }) {
  const [frequency, setFrequency] = useState<ScheduleFrequency>(
    work.schedule?.frequency ?? ScheduleFrequency.Weekly,
  );
  const [time, setTime] = useState(work.schedule?.time ?? '09:00');
  const [prompt, setPrompt] = useState(work.schedule?.prompt ?? '');
  const [enabled, setEnabled] = useState(work.schedule?.enabled ?? false);
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (work.status === WorkStatus.Archived || (enabled && !prompt.trim())) return;
        const changed = demoStore.setSchedule(work.id, {
          frequency,
          time,
          prompt: prompt.trim(),
          enabled,
        });
        setSaved(
          changed ||
            (work.schedule?.frequency === frequency &&
              work.schedule?.time === time &&
              work.schedule?.prompt === prompt.trim() &&
              work.schedule?.enabled === enabled),
        );
      }}
    >
      <Muted>{t(language, 'scheduleDemoHint')}</Muted>
      <fieldset className="flex flex-col gap-4" disabled={work.status === WorkStatus.Archived}>
        <label className="flex gap-3 items-center">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              setEnabled(event.target.checked);
              setSaved(false);
            }}
          />
          {t(language, 'scheduleEnabled')}
        </label>
        <label className="field">
          <span>{t(language, 'scheduleFrequency')}</span>
          <select
            className="select"
            value={frequency}
            onChange={(event) => {
              setFrequency(event.target.value as ScheduleFrequency);
              setSaved(false);
            }}
          >
            {(
              [
                ['daily', 'scheduleDaily'],
                ['weekdays', 'scheduleWeekdays'],
                ['weekly', 'scheduleWeekly'],
              ] as const
            ).map(([value, key]) => (
              <option value={value} key={value}>
                {t(language, key)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t(language, 'scheduleTime')}</span>
          <input
            className="input"
            type="time"
            value={time}
            required
            onChange={(event) => {
              setTime(event.target.value);
              setSaved(false);
            }}
          />
        </label>
        <label className="field">
          <span>{t(language, 'schedulePrompt')}</span>
          <textarea
            className="input"
            value={prompt}
            required={enabled}
            onChange={(event) => {
              setPrompt(event.target.value);
              setSaved(false);
            }}
            placeholder={t(language, 'schedulePromptPlaceholder')}
          />
        </label>
        <Button type="submit" disabled={work.status === WorkStatus.Archived}>
          {t(language, 'save')}
        </Button>
      </fieldset>
      {saved && work.status !== WorkStatus.Archived && (
        <p className="muted" role="status">
          {t(language, 'scheduleSaved')}
        </p>
      )}
    </form>
  );
}
export function WorkContext({ work, language }: { work: Work; language: Language }) {
  const [tab, setTab] = useState<TranslationKey>(Tab.Dossier);
  return (
    <aside className="context-panel" id="work-record">
      <div className="context-tabs" aria-label={t(language, 'showDossier')}>
        {Object.values(Tab).map((item) => (
          <Button
            key={item}
            size="small"
            variant="ghost"
            aria-pressed={tab === item}
            onClick={() => setTab(item)}
          >
            {t(language, item)}
          </Button>
        ))}
      </div>
      {tab === Tab.Dossier && (
        <>
          {work.dossier.length ? (
            work.dossier.map((entry) => (
              <DossierRow key={entry.id} entry={entry} work={work} language={language} />
            ))
          ) : (
            <Muted>{t(language, 'noDossier')}</Muted>
          )}
        </>
      )}
      {tab === Tab.Artifacts && (
        <>
          {work.artifacts.length ? (
            work.artifacts.map((artifact) => (
              <details key={artifact.id} className="details">
                <summary>{localize(language, artifact.title)}</summary>
                <Muted>{localize(language, artifact.summary)}</Muted>
                <p className="field-hint mt-3">{t(language, 'artifactDemoHint')}</p>
                <pre className="preview mt-3">{localize(language, artifact.content)}</pre>
              </details>
            ))
          ) : (
            <Muted>{t(language, 'noArtifacts')}</Muted>
          )}
        </>
      )}
      {tab === Tab.Plan && (
        <>
          {work.plan.length ? (
            <ol className="timeline">
              {work.plan.map((item) => (
                <li key={item.id}>
                  <p className="reading">{localize(language, item.title)}</p>
                  <Muted>
                    {t(
                      language,
                      item.status === 'done'
                        ? 'planDone'
                        : item.status === 'in-progress'
                          ? 'planInProgress'
                          : 'planPending',
                    )}
                  </Muted>
                </li>
              ))}
            </ol>
          ) : (
            <Muted>{t(language, 'noPlan')}</Muted>
          )}
        </>
      )}
      {tab === Tab.Schedule && <Schedule key={work.id} work={work} language={language} />}
    </aside>
  );
}
