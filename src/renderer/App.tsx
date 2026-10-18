import { useEffect, useState } from 'react';
import { Orbit } from 'lucide-react';
import { Home } from './pages/Home';
import { NewWork } from './pages/NewWork';
import { WorkPage } from './pages/WorkPage';
import { Settings, Theme } from './pages/Settings';
import { Capabilities } from './pages/Capabilities';
import { useDemoStore } from './state';
import { t } from './i18n';
const Route = {
  Home: '/',
  New: '/new',
  Settings: '/settings',
  Capabilities: '/capabilities',
  Work: '/work/',
} as const;
export function App() {
  const state = useDemoStore();
  const [hash, setHash] = useState(window.location.hash.slice(1) || Route.Home);
  const [theme, setTheme] = useState<Theme>(Theme.System);
  useEffect(() => {
    const onHash = () => {
      setHash(window.location.hash.slice(1) || Route.Home);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === Theme.System ? (media.matches ? Theme.Dark : Theme.Light) : theme;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = state.language === 'zh' ? 'zh-CN' : 'en';
  }, [state.language]);
  const [path, query] = hash.split('?');
  const welcome = path === Route.Home && !state.works.length;
  const nav = [
    [Route.Home, 'briefing'],
    [Route.Capabilities, 'capabilities'],
    [Route.Settings, 'settings'],
  ] as const;
  return (
    <div className={`app-shell${welcome ? ' is-welcome' : ''}`} data-testid="app-shell">
      <div className="art" aria-hidden="true" />
      <header className="header">
        <a className="brand" href="#/" aria-label={t(state.language, 'appName')}>
          <Orbit aria-hidden="true" />
          <span>{state.language === 'zh' ? '搭子 · Dazi' : 'Dazi'}</span>
        </a>
        <nav className="nav" aria-label={t(state.language, 'works')}>
          {nav.map(([href, key]) => (
            <a key={href} href={`#${href}`} aria-current={path === href ? 'page' : undefined}>
              {t(state.language, key)}
            </a>
          ))}
        </nav>
      </header>
      <p className="demo-notice">{t(state.language, 'demoNotice')}</p>
      {path === Route.Settings ? (
        <Settings language={state.language} theme={theme} setTheme={setTheme} />
      ) : path === Route.Capabilities ? (
        <Capabilities language={state.language} />
      ) : path === Route.New ? (
        <NewWork
          key={hash}
          language={state.language}
          initialGoal={new URLSearchParams(query).get('goal') ?? ''}
        />
      ) : path.startsWith(Route.Work) ? (
        <WorkPage
          key={path}
          work={state.works.find((work) => work.id === path.slice(Route.Work.length))}
          language={state.language}
        />
      ) : (
        <Home works={state.works} language={state.language} />
      )}
    </div>
  );
}
