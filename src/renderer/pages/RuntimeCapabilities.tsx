import { runtimeErrorText } from '../i18n/errors';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '../../shared/components/ui/button';
import { Title, Muted } from '../../shared/components/ui/typography';
import { runtimeClient } from '../runtime/client';
import { rt } from '../i18n/runtime';
import type { Language } from '../i18n';
import type { ModelInfo } from '../../shared/rpc/protocol';
export function RuntimeCapabilities({ language }: { language: Language }) {
  const connection = useSyncExternalStore(
    runtimeClient.subscribe,
    runtimeClient.getSnapshot,
    runtimeClient.getSnapshot,
  );
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selection, setSelection] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!connection.connected) return;
    setError('');
    let live = true;
    void runtimeClient
      .request('listModels', {})
      .then((result) => {
        if (live) {
          setModels(result.models);
          setSelection(
            result.selected ? `${result.selected.provider}/${result.selected.modelId}` : '',
          );
        }
      })
      .catch((cause: Error) => {
        if (live) setError(runtimeErrorText(language, cause));
      });
    return () => {
      live = false;
    };
  }, [connection.connected, connection.generation]);
  return (
    <main className="page page-narrow">
      <Title>{rt(language, 'configuration')}</Title>
      <Muted className="mt-3">{rt(language, 'configurationHint')}</Muted>
      <form
        className="flex flex-col gap-6 mt-12"
        onSubmit={async (event) => {
          event.preventDefault();
          const model = models.find((item) => `${item.provider}/${item.modelId}` === selection);
          if (!model || !model.configured || busy) return;
          setBusy(true);
          setError('');
          setSaved(false);
          try {
            await runtimeClient.request('configureModel', {
              provider: model.provider,
              modelId: model.modelId,
            });
            setSaved(true);
          } catch (cause) {
            setError(runtimeErrorText(language, cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>{rt(language, 'model')}</span>
          <select
            disabled={busy}
            className="select"
            value={selection}
            onChange={(event) => {
              setSelection(event.target.value);
              setSaved(false);
            }}
            data-testid="runtime-model"
          >
            <option value="">{rt(language, 'noModel')}</option>
            {models.map((model) => (
              <option
                key={`${model.provider}/${model.modelId}`}
                value={`${model.provider}/${model.modelId}`}
                disabled={!model.configured}
              >
                {model.name}
                {!model.configured ? ` · ${rt(language, 'missingKey')}` : ''}
              </option>
            ))}
          </select>
        </label>
        <Muted>{rt(language, 'credentials')}</Muted>
        <Button type="submit" variant="primary" disabled={busy || !selection}>
          {rt(language, 'saveModel')}
        </Button>
        {saved && (
          <p role="status" className="muted">
            {rt(language, 'modelSaved')}
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </form>
      <section className="setting-row">
        <div>
          <h2>{rt(language, 'tools')}</h2>
          <Muted>{rt(language, 'toolsHint')}</Muted>
        </div>
      </section>
      <Muted>{rt(language, 'otherCapabilities')}</Muted>
    </main>
  );
}
