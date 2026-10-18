import { useRef, useState, useSyncExternalStore } from 'react';
import { Brain, Plug, BookOpen } from 'lucide-react';
import { Button } from '../../shared/components/ui/button';
import { Title, Muted } from '../../shared/components/ui/typography';
import { t, type Language, type TranslationKey } from '../i18n';

const Provider = { OpenAI: 'openai', Anthropic: 'anthropic', Custom: 'custom' } as const;
type Provider = (typeof Provider)[keyof typeof Provider];
const providerLabels: Record<Provider, TranslationKey> = {
  [Provider.OpenAI]: 'providerOpenAI',
  [Provider.Anthropic]: 'providerAnthropic',
  [Provider.Custom]: 'providerCustom',
};
const Skill = { Writing: 'writing', Research: 'research', Planning: 'planning' } as const;
type Skill = (typeof Skill)[keyof typeof Skill];
const skillOptions: readonly [Skill, TranslationKey, TranslationKey][] = [
  [Skill.Writing, 'skillWriting', 'skillWritingDescription'],
  [Skill.Research, 'skillResearch', 'skillResearchDescription'],
  [Skill.Planning, 'skillPlanning', 'skillPlanningDescription'],
];
interface ModelDraft {
  provider: Provider;
  name: string;
  isDefault: boolean;
}
interface ToolDraft {
  id: string;
  name: string;
  endpoint: string;
}
interface CapabilitySnapshot {
  model: ModelDraft | null;
  tools: readonly ToolDraft[];
  skills: Readonly<Record<Skill, boolean>>;
}
// UI drafts only: retained across navigation, discarded on reload. No IO or execution.
let snapshot: CapabilitySnapshot = {
  model: null,
  tools: [],
  skills: { [Skill.Writing]: true, [Skill.Research]: false, [Skill.Planning]: true },
};
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = () => snapshot;
function updateDrafts(change: Partial<CapabilitySnapshot>) {
  snapshot = { ...snapshot, ...change };
  [...listeners].forEach((listener) => listener());
}
const secretPattern =
  /(?:\b(?:sk[-_]|AIza|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}|\bBearer\s+\S+|(?:api[_-]?key|password|access[_-]?token)\s*[:=])/i;

function endpointError(raw: string): TranslationKey | null {
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash || secretPattern.test(raw))
      return 'toolEndpointSecret';
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!url.hostname || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)))
      return 'toolEndpointInvalid';
    return null;
  } catch {
    return 'toolEndpointInvalid';
  }
}
function ModelConfiguration({ language }: { language: Language }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [provider, setProvider] = useState<Provider>(state.model?.provider ?? Provider.OpenAI);
  const [name, setName] = useState(state.model?.name ?? '');
  const [isDefault, setIsDefault] = useState(state.model?.isDefault ?? true);
  const [preview, setPreview] = useState<ModelDraft | null>(null);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [feedback, setFeedback] = useState<TranslationKey | null>(null);
  const changed = () => {
    setPreview(null);
    setError(null);
    setFeedback(null);
  };
  return (
    <div className="flex flex-col gap-4 min-w-0">
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setFeedback(null);
          if (!name.trim()) {
            setError('modelNameRequired');
            return;
          }
          if (secretPattern.test(name)) {
            setError('capabilitySecretRejected');
            return;
          }
          setError(null);
          setPreview({ provider, name: name.trim(), isDefault });
        }}
      >
        <label className="field">
          <span>{t(language, 'modelProvider')}</span>
          <select
            className="select"
            data-testid="model-provider"
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value as Provider);
              changed();
            }}
          >
            {Object.values(Provider).map((value) => (
              <option key={value} value={value}>
                {t(language, providerLabels[value])}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t(language, 'modelDisplayName')}</span>
          <input
            className="input"
            data-testid="model-name"
            value={name}
            maxLength={80}
            required
            placeholder={t(language, 'modelDisplayPlaceholder')}
            aria-invalid={Boolean(error)}
            aria-describedby="model-name-hint model-error"
            onChange={(event) => {
              setName(event.target.value);
              changed();
            }}
          />
          <span className="field-hint" id="model-name-hint">
            {t(language, 'modelDisplayHint')}
          </span>
        </label>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(event) => {
              setIsDefault(event.target.checked);
              changed();
            }}
          />
          <span>{t(language, 'modelDefaultToggle')}</span>
        </label>
        <p className="error" id="model-error" role={error ? 'alert' : undefined}>
          {error ? t(language, error) : null}
        </p>
        <div>
          <Button type="submit" data-testid="model-preview">
            {t(language, 'previewConfiguration')}
          </Button>
        </div>
      </form>
      {preview && (
        <section className="flex flex-col gap-3" aria-label={t(language, 'modelPreview')}>
          <h3>{t(language, 'modelPreview')}</h3>
          <p>
            {t(language, providerLabels[preview.provider])} · {preview.name}
          </p>
          <Muted>{t(language, preview.isDefault ? 'modelDefault' : 'modelNotDefault')}</Muted>
          <Muted>{t(language, 'modelSaveExplanation')}</Muted>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="primary"
              data-testid="model-save"
              onClick={() => {
                updateDrafts({ model: preview });
                setPreview(null);
                setRemoving(false);
                setFeedback('modelDraftSaved');
              }}
            >
              {t(language, 'saveDraft')}
            </Button>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              {t(language, 'cancel')}
            </Button>
          </div>
        </section>
      )}
      {state.model && (
        <section className="flex flex-col gap-3" aria-label={t(language, 'savedModelDraft')}>
          <h3>{t(language, 'savedModelDraft')}</h3>
          <p>
            {state.model.name} · {t(language, providerLabels[state.model.provider])}
          </p>
          <Muted>
            {t(language, 'draftOnly')} ·{' '}
            {t(language, state.model.isDefault ? 'modelDefault' : 'modelNotDefault')}
          </Muted>
          {removing ? (
            <div className="flex flex-col gap-3">
              <p>{t(language, 'modelRemoveQuestion')}</p>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="danger"
                  data-testid="model-remove-confirm"
                  onClick={() => {
                    updateDrafts({ model: null });
                    setRemoving(false);
                    setPreview(null);
                    setName('');
                    setFeedback('modelDraftRemoved');
                  }}
                >
                  {t(language, 'confirmRemoveDraft')}
                </Button>
                <Button variant="ghost" onClick={() => setRemoving(false)}>
                  {t(language, 'cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button variant="ghost" data-testid="model-remove" onClick={() => setRemoving(true)}>
                {t(language, 'removeDraft')}
              </Button>
            </div>
          )}
        </section>
      )}
      <p className="muted" role="status">
        {feedback ? t(language, feedback) : null}
      </p>
    </div>
  );
}
function ToolConfiguration({ language }: { language: Language }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const sequence = useRef(0);
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [preview, setPreview] = useState<Omit<ToolDraft, 'id'> | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [feedback, setFeedback] = useState<TranslationKey | null>(null);
  const changed = () => {
    setPreview(null);
    setError(null);
    setFeedback(null);
  };
  return (
    <div className="flex flex-col gap-4 min-w-0">
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setFeedback(null);
          if (!name.trim()) {
            setError('toolNameRequired');
            return;
          }
          if (secretPattern.test(name)) {
            setError('capabilitySecretRejected');
            return;
          }
          const invalid = endpointError(endpoint.trim());
          if (invalid) {
            setError(invalid);
            return;
          }
          const normalized = new URL(endpoint.trim()).href;
          if (state.tools.some((tool) => tool.endpoint === normalized)) {
            setError('toolDuplicate');
            return;
          }
          setError(null);
          setPreview({ name: name.trim(), endpoint: normalized });
        }}
      >
        <label className="field">
          <span>{t(language, 'toolName')}</span>
          <input
            className="input"
            data-testid="tool-name"
            value={name}
            maxLength={80}
            required
            placeholder={t(language, 'toolNamePlaceholder')}
            aria-invalid={error === 'toolNameRequired' || error === 'capabilitySecretRejected'}
            aria-describedby="tool-error"
            onChange={(event) => {
              setName(event.target.value);
              changed();
            }}
          />
        </label>
        <label className="field">
          <span>{t(language, 'toolEndpoint')}</span>
          <input
            className="input"
            data-testid="tool-endpoint"
            type="url"
            value={endpoint}
            maxLength={500}
            required
            placeholder={t(language, 'toolEndpointPlaceholder')}
            aria-invalid={Boolean(
              error && error !== 'toolNameRequired' && error !== 'capabilitySecretRejected',
            )}
            aria-describedby="tool-endpoint-hint tool-error"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setEndpoint(event.target.value);
              changed();
            }}
          />
          <span className="field-hint" id="tool-endpoint-hint">
            {t(language, 'toolEndpointHint')}
          </span>
        </label>
        <p className="error" id="tool-error" role={error ? 'alert' : undefined}>
          {error ? t(language, error) : null}
        </p>
        <div>
          <Button type="submit" data-testid="tool-preview">
            {t(language, 'previewTool')}
          </Button>
        </div>
      </form>
      {preview && (
        <section className="flex flex-col gap-3 min-w-0" aria-label={t(language, 'toolPreview')}>
          <h3>{t(language, 'toolPreview')}</h3>
          <p>{preview.name}</p>
          <p className="break-all">{preview.endpoint}</p>
          <Muted>{t(language, 'toolSaveExplanation')}</Muted>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="primary"
              data-testid="tool-save"
              onClick={() => {
                // Recheck before committing so repeated previews never add a duplicate.
                if (snapshot.tools.some((tool) => tool.endpoint === preview.endpoint)) {
                  setError('toolDuplicate');
                  setPreview(null);
                  return;
                }
                updateDrafts({
                  tools: [
                    ...snapshot.tools,
                    { ...preview, id: `${Date.now()}-${++sequence.current}` },
                  ],
                });
                setName('');
                setEndpoint('');
                setPreview(null);
                setFeedback('toolDraftSaved');
              }}
            >
              {t(language, 'saveDraft')}
            </Button>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              {t(language, 'cancel')}
            </Button>
          </div>
        </section>
      )}
      <section className="flex flex-col gap-4 min-w-0" aria-label={t(language, 'savedToolDrafts')}>
        <h3>{t(language, 'savedToolDrafts')}</h3>
        {!state.tools.length && <Muted>{t(language, 'noToolDrafts')}</Muted>}
        {state.tools.map((tool) => (
          <div key={tool.id} className="flex flex-col gap-3 min-w-0" data-testid="tool-draft">
            <p>{tool.name}</p>
            <p className="muted break-all">{tool.endpoint}</p>
            <Muted>{t(language, 'draftOnly')}</Muted>
            {removing === tool.id ? (
              <div className="flex flex-col gap-3">
                <p>{t(language, 'removeToolQuestion', { name: tool.name })}</p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="danger"
                    data-testid="tool-remove-confirm"
                    onClick={() => {
                      updateDrafts({ tools: snapshot.tools.filter((item) => item.id !== tool.id) });
                      setRemoving(null);
                      setFeedback('toolDraftRemoved');
                    }}
                  >
                    {t(language, 'confirmRemoveDraft')}
                  </Button>
                  <Button variant="ghost" onClick={() => setRemoving(null)}>
                    {t(language, 'cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <Button
                  variant="ghost"
                  data-testid="tool-remove"
                  onClick={() => setRemoving(tool.id)}
                >
                  {t(language, 'removeDraft')}
                </Button>
              </div>
            )}
          </div>
        ))}
      </section>
      <div>
        <Button disabled aria-describedby="connection-unavailable">
          {t(language, 'testConnection')}
        </Button>
      </div>
      <Muted id="connection-unavailable">{t(language, 'connectionUnavailable')}</Muted>
      <p className="muted" role="status">
        {feedback ? t(language, feedback) : null}
      </p>
    </div>
  );
}
function SkillConfiguration({ language }: { language: Language }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [changed, setChanged] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <Muted>{t(language, 'skillDemoHint')}</Muted>
      {skillOptions.map(([id, title, description]) => (
        <div key={id} className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3>{t(language, title)}</h3>
              <Muted>{t(language, description)}</Muted>
            </div>
            <Button
              size="small"
              aria-pressed={state.skills[id]}
              aria-label={t(language, 'skillToggleLabel', { name: t(language, title) })}
              data-testid={`skill-${id}`}
              onClick={() => {
                updateDrafts({ skills: { ...snapshot.skills, [id]: !snapshot.skills[id] } });
                setChanged(true);
              }}
            >
              {t(language, state.skills[id] ? 'disableSkill' : 'enableSkill')}
            </Button>
          </div>
          <Muted>{t(language, state.skills[id] ? 'skillEnabled' : 'skillDisabled')}</Muted>
        </div>
      ))}
      <p className="muted" role="status">
        {changed ? t(language, 'skillSettingSaved') : null}
      </p>
    </div>
  );
}
export function Capabilities({ language }: { language: Language }) {
  return (
    <main className="page page-narrow">
      <Title>{t(language, 'capabilitiesTitle')}</Title>
      <Muted className="mt-3">{t(language, 'capabilitiesIntro')}</Muted>
      <Muted className="mt-3">{t(language, 'capabilityDraftNotice')}</Muted>
      <p className="field-hint mt-3">{t(language, 'capabilityNoSecrets')}</p>
      <section className="setting-row">
        <div>
          <h2 className="flex items-center gap-3">
            <Brain aria-hidden="true" />
            {t(language, 'modelConnection')}
          </h2>
          <Muted>{t(language, 'modelDescription')}</Muted>
        </div>
        <ModelConfiguration language={language} />
      </section>
      <section className="setting-row">
        <div>
          <h2 className="flex items-center gap-3">
            <Plug aria-hidden="true" />
            {t(language, 'toolsConnection')}
          </h2>
          <Muted>{t(language, 'toolsDescription')}</Muted>
        </div>
        <ToolConfiguration language={language} />
      </section>
      <section className="setting-row">
        <div>
          <h2 className="flex items-center gap-3">
            <BookOpen aria-hidden="true" />
            {t(language, 'skillsConnection')}
          </h2>
          <Muted>{t(language, 'skillsDescription')}</Muted>
        </div>
        <SkillConfiguration language={language} />
      </section>
    </main>
  );
}
