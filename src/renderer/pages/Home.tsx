import { ArrowUpRight, Plus } from 'lucide-react';
import { Button } from '../../shared/components/ui/button';
import { Title, SectionTitle, Muted } from '../../shared/components/ui/typography';
import { Composer, DecisionView, OpenWork, Status, navigate } from '../components/common';
import { t, localize, type Language, type TranslationKey } from '../i18n';
import { DecisionStatus, WorkStatus, PlanStatus, type Work } from '../state';
export function Home({ works, language }: { works: readonly Work[]; language: Language }) {
  const active = works.filter((work) => work.status !== WorkStatus.Archived);
  if (!works.length)
    return (
      <>
        <main className="welcome">
          <h1 className="welcome-title" data-testid="page-title">
            {t(language, 'welcomeTitle')}
          </h1>
          <p className="welcome-subtitle">{t(language, 'welcomeSubtitle')}</p>
          <Composer
            language={language}
            welcome
            onSubmit={(goal) => navigate(`/new?goal=${encodeURIComponent(goal)}`)}
          />
          <div className="suggestions">
            {(
              [
                'welcomeSuggestIdea',
                'welcomeSuggestReply',
                'welcomeSuggestPlan',
              ] as TranslationKey[]
            ).map((key) => (
              <Button
                key={key}
                variant="ghost"
                onClick={() => navigate(`/new?goal=${encodeURIComponent(t(language, key))}`)}
              >
                {t(language, key)}
                <ArrowUpRight aria-hidden="true" />
              </Button>
            ))}
          </div>
        </main>
        <footer className="welcome-footer">{t(language, 'welcomeFooter')}</footer>
      </>
    );
  const pending = active.flatMap((work) =>
    work.decisions
      .filter((d) => d.status === DecisionStatus.Pending)
      .map((decision) => ({ work, decision })),
  );
  const hour = new Date().getHours();
  return (
    <main className="page">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <Title>
            {t(language, hour < 12 ? 'goodMorning' : hour < 18 ? 'goodAfternoon' : 'goodEvening')}
          </Title>
          <Muted className="mt-3">
            {t(language, 'briefingSummary')
              .replace(
                '{active}',
                String(
                  active.filter(
                    (work) =>
                      work.status === WorkStatus.Running || work.status === WorkStatus.Queued,
                  ).length,
                ),
              )
              .replace('{waiting}', String(pending.length))}
          </Muted>
        </div>
        <Button variant="primary" onClick={() => navigate('/new')}>
          <Plus />
          {t(language, 'newWork')}
        </Button>
      </div>
      <div className="briefing-grid">
        <div>
          <section className="section">
            <SectionTitle>
              {t(language, 'needsYou')} · {pending.length}
            </SectionTitle>
            {pending.length ? (
              <div className="flex flex-col gap-6">
                {pending.map(({ work, decision }) => (
                  <div key={decision.id}>
                    <DecisionView workId={work.id} decision={decision} language={language} />
                    <div className="mt-2">
                      <OpenWork id={work.id} language={language} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Muted>{t(language, 'noDecisions')}</Muted>
            )}
          </section>
          <section className="section">
            <SectionTitle>{t(language, 'recentProgress')}</SectionTitle>
            {active.length ? (
              active.map((work) => (
                <article className="work-row" key={work.id}>
                  <div className="min-w-0">
                    <h3 className="work-row-title">{localize(language, work.title)}</h3>
                    <p className="muted">{localize(language, work.summary)}</p>
                    <div className="mt-3">
                      <Status status={work.status} language={language} />
                    </div>
                  </div>
                  <OpenWork id={work.id} language={language} />
                </article>
              ))
            ) : (
              <Muted>{t(language, 'noProgress')}</Muted>
            )}
          </section>
        </div>
        <aside>
          <SectionTitle>{t(language, 'nextSteps')}</SectionTitle>
          <ul className="timeline mt-6">
            {active.flatMap((work) =>
              work.plan
                .filter((item) => item.status !== PlanStatus.Done)
                .slice(0, 1)
                .map((item) => (
                  <li key={item.id}>
                    <p className="reading">{localize(language, item.title)}</p>
                    <div className="mt-2">
                      <OpenWork id={work.id} language={language} />
                    </div>
                  </li>
                )),
            )}
          </ul>
          {!active.some((work) => work.plan.some((item) => item.status !== PlanStatus.Done)) && (
            <Muted className="mt-4">{t(language, 'noNextSteps')}</Muted>
          )}
          {works.some((work) => work.status === WorkStatus.Archived) && (
            <details className="details">
              <summary>{t(language, 'archived')}</summary>
              {works
                .filter((work) => work.status === WorkStatus.Archived)
                .map((work) => (
                  <div key={work.id} className="context-item">
                    <p>{localize(language, work.title)}</p>
                    <OpenWork id={work.id} language={language} />
                  </div>
                ))}
            </details>
          )}
        </aside>
      </div>
    </main>
  );
}
