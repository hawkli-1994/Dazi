import { isAbsolute, relative, resolve, sep } from 'node:path';

export const AppOrigin = 'dazi://app';
export const AppEntry = `${AppOrigin}/index.html`;
export const AppScheme = 'dazi';

export function rendererEntry(devUrl: string | undefined, packaged: boolean): string {
  if (!devUrl || packaged) return AppEntry;
  const url = new URL(devUrl);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('Renderer development URL must be a loopback HTTP origin.');
  }
  return url.href;
}

export function isTrustedDocument(candidate: string, entry: string): boolean {
  try {
    const url = new URL(candidate);
    const expected = new URL(entry);
    return (
      url.protocol === expected.protocol &&
      url.host === expected.host &&
      url.pathname === expected.pathname &&
      !url.username &&
      !url.password &&
      !url.search
    );
  } catch {
    return false;
  }
}

export function isTrustedSender(
  sender: { sender: unknown; senderFrame: { url: string } | null },
  contents: { mainFrame: unknown },
  entry: string,
): boolean {
  return (
    sender.sender === contents &&
    sender.senderFrame === contents.mainFrame &&
    isTrustedDocument(sender.senderFrame?.url ?? '', entry)
  );
}

export function resolveAppAsset(requestUrl: string, root: string): string | null {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== `${AppScheme}:` || url.host !== 'app' || url.username || url.password) {
      return null;
    }
    const decoded = decodeURIComponent(url.pathname);
    if (decoded.includes('\0') || decoded.includes('\\')) return null;
    const candidate = resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`);
    const path = relative(root, candidate);
    if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) return null;
    return candidate;
  } catch {
    return null;
  }
}

export function allowsRendererRequest(requestUrl: string, entry: string): boolean {
  try {
    const url = new URL(requestUrl);
    const expected = new URL(entry);
    if (url.username || url.password) return false;
    return (
      url.host === expected.host &&
      (url.protocol === expected.protocol ||
        (expected.protocol === 'http:' && url.protocol === 'ws:'))
    );
  } catch {
    return false;
  }
}

export function rendererCsp(entry: string): string {
  const url = new URL(entry);
  const connect = url.protocol === 'http:' ? `${url.origin} ws://${url.host}` : "'none'";
  return [
    "default-src 'none'",
    url.protocol === 'http:' ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "worker-src 'none'",
  ].join('; ');
}
