import { memo, useMemo, type ComponentProps } from 'react';
import { externalWebUrl, type DesktopBridge } from '../../../shared/rpc/desktop';
import {
  Streamdown,
  defaultRehypePlugins,
  type Components,
  type StreamdownProps,
} from 'streamdown';
import { cjk } from '@streamdown/cjk';
import type { ImageContent } from '@earendil-works/pi-ai';
import { agentText, type AgentLanguage } from '../../i18n/agent';

// Exclude rehype-raw entirely. Sanitization alone must never parse raw HTML into elements.
const plugins = { cjk };
const rehypePlugins: StreamdownProps['rehypePlugins'] = [defaultRehypePlugins.sanitize];
const allowedElements = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  'a',
  'img',
  'blockquote',
  'code',
  'pre',
  'ol',
  'ul',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'input',
];

/** Rendering never visits links. Only explicit user clicks may open public web URLs. */
export function safeLink(url: string): string | undefined {
  return externalWebUrl(url) ?? undefined;
}

/** Keep the bridge call synchronous with the click so preload can verify user activation. */
export function openExplicitLink(
  event: { preventDefault(): void },
  url: string,
  desktop: Pick<DesktopBridge, 'openExternal'> | undefined,
): Promise<boolean> | undefined {
  if (!desktop) return undefined;
  event.preventDefault();
  const safe = safeLink(url);
  if (!safe) return undefined;
  return desktop.openExternal(safe).catch(() => false);
}

const safeUrlTransform: StreamdownProps['urlTransform'] = (url, key) =>
  key === 'href' ? safeLink(url) : undefined;

function SafeAnchor({ href, children }: ComponentProps<'a'>) {
  const target = href ? safeLink(href) : undefined;
  return target ? (
    <a
      href={target}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
      onClick={(event) => {
        void openExplicitLink(event, target, window.daziDesktop);
      }}
    >
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );
}

export const AgentMarkdown = memo(function AgentMarkdown({
  children,
  language,
  streaming = false,
}: {
  children: string;
  language: AgentLanguage;
  streaming?: boolean;
}) {
  const components = useMemo<Components>(
    () => ({
      a: SafeAnchor,
      strong: ({ children }) => <strong>{children}</strong>,
      em: ({ children }) => <em>{children}</em>,
      // An img element is never created for Markdown, including data URLs and tracking pixels.
      img: ({ alt }) => (
        <span className="agent-image-notice">
          {agentText(language, 'remoteImage')}
          {alt ? ` · ${alt}` : ''}
        </span>
      ),
      pre: ({ children }) => (
        <pre className="agent-code" tabIndex={0}>
          {children}
        </pre>
      ),
      code: ({ children }) => <code>{children}</code>,
      table: ({ children }) => (
        <div className="agent-table-scroll" tabIndex={0}>
          <table>{children}</table>
        </div>
      ),
      input: ({ checked }) => (
        <input type="checkbox" checked={Boolean(checked)} disabled readOnly />
      ),
    }),
    [language],
  );
  return (
    <Streamdown
      className="agent-markdown"
      mode={streaming ? 'streaming' : 'static'}
      parseIncompleteMarkdown
      animated={false}
      isAnimating={false}
      controls={false}
      plugins={plugins}
      components={components}
      rehypePlugins={rehypePlugins}
      allowedElements={allowedElements}
      skipHtml
      urlTransform={safeUrlTransform}
    >
      {children}
    </Streamdown>
  );
});

const rasterMimeTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export function LocalImage({
  content,
  language,
}: {
  content: ImageContent;
  language: AgentLanguage;
}) {
  // Native Pi images contain bytes, never remote URLs. SVG is intentionally excluded.
  if (!rasterMimeTypes.has(content.mimeType) || !/^[a-zA-Z0-9+/=\s]+$/.test(content.data)) {
    return <p className="agent-note">{agentText(language, 'imageUnavailable')}</p>;
  }
  return (
    <img
      className="agent-local-image"
      src={`data:${content.mimeType};base64,${content.data}`}
      alt={agentText(language, 'image')}
    />
  );
}
