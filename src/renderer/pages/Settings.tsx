import { useState } from 'react';
import { Button } from '../../shared/components/ui/button';
import { Title, Muted } from '../../shared/components/ui/typography';
import { t, type Language } from '../i18n';
import { demoStore } from '../state';
import { clearDrafts, navigate } from '../components/common';
export const Theme = { Light: 'light', Dark: 'dark', System: 'system' } as const;
export type Theme = (typeof Theme)[keyof typeof Theme];
export function Settings({
  language,
  theme,
  setTheme,
}: {
  language: Language;
  theme: Theme;
  setTheme: (theme: Theme) => void;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <main className="page page-narrow">
      <Title>{t(language, 'settings')}</Title>
      <Muted className="mt-3">{t(language, 'preferencesDescription')}</Muted>
      <section className="setting-row">
        <div>
          <h2>{t(language, 'appearance')}</h2>
          <Muted>{t(language, 'theme')}</Muted>
        </div>
        <label className="field">
          <span className="sr-only">{t(language, 'theme')}</span>
          <select
            className="select"
            data-testid="theme-select"
            value={theme}
            onChange={(event) => setTheme(event.target.value as Theme)}
          >
            <option value={Theme.Light}>{t(language, 'themeLight')}</option>
            <option value={Theme.Dark}>{t(language, 'themeDark')}</option>
            <option value={Theme.System}>{t(language, 'themeSystem')}</option>
          </select>
        </label>
      </section>
      <section className="setting-row">
        <div>
          <h2>{t(language, 'language')}</h2>
          <Muted>简体中文 / English</Muted>
        </div>
        <label className="field">
          <span className="sr-only">{t(language, 'language')}</span>
          <select
            className="select"
            data-testid="locale-select"
            value={language}
            onChange={(event) => demoStore.setLanguage(event.target.value as Language)}
          >
            <option value="zh">简体中文</option>
            <option value="en">English</option>
          </select>
        </label>
      </section>
      <section className="setting-row">
        <div>
          <h2>{t(language, 'demoSettings')}</h2>
          <Muted>{t(language, 'demoSettingsDescription')}</Muted>
        </div>
        <div className="flex flex-col gap-3 items-start">
          <Button
            data-testid="load-demo"
            onClick={() => {
              demoStore.loadFixtures();
              navigate('/');
            }}
          >
            {t(language, 'loadDemo')}
          </Button>
          <Button variant="ghost" data-testid="reset-demo" onClick={() => setConfirmReset(true)}>
            {t(language, 'emptyDemo')}
          </Button>
        </div>
      </section>
      {confirmReset && (
        <section className="decision mt-6" role="alert">
          <h3>{t(language, 'resetDemoTitle')}</h3>
          <Muted>{t(language, 'demoSettingsDescription')}</Muted>
          <div className="flex gap-3 mt-4">
            <Button
              variant="danger"
              onClick={() => {
                clearDrafts();
                demoStore.reset();
                setConfirmReset(false);
                navigate('/');
              }}
            >
              {t(language, 'emptyDemo')}
            </Button>
            <Button onClick={() => setConfirmReset(false)}>{t(language, 'cancel')}</Button>
          </div>
        </section>
      )}
      <section className="setting-row">
        <div>
          <h2>{t(language, 'about')}</h2>
          <Muted>{t(language, 'version')}</Muted>
        </div>
        <Muted>{t(language, 'demoDescription')}</Muted>
      </section>
    </main>
  );
}
