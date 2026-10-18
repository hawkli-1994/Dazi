import { Brain, Plug, BookOpen } from 'lucide-react';
import { Title, Muted } from '../../shared/components/ui/typography';
import { t, type Language, type TranslationKey } from '../i18n';
export function Capabilities({ language }: { language: Language }) {
  const rows: { title: TranslationKey; description: TranslationKey; icon: typeof Brain }[] = [
    { title: 'modelConnection', description: 'modelDescription', icon: Brain },
    { title: 'toolsConnection', description: 'toolsDescription', icon: Plug },
    { title: 'skillsConnection', description: 'skillsDescription', icon: BookOpen },
  ];
  return (
    <main className="page page-narrow">
      <Title>{t(language, 'capabilitiesTitle')}</Title>
      <Muted className="mt-3">{t(language, 'capabilitiesDescription')}</Muted>
      <div className="mt-8">
        {rows.map(({ title, description, icon: Icon }) => (
          <section key={title} className="setting-row">
            <div>
              <h2 className="flex items-center gap-3">
                <Icon aria-hidden="true" />
                {t(language, title)}
              </h2>
              <Muted>{t(language, description)}</Muted>
            </div>
            <div>
              <p className="status">{t(language, 'notConnected')}</p>
              <Muted className="mt-3">{t(language, 'noCredentials')}</Muted>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
