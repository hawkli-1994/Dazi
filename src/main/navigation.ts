import { isTrustedDocument } from './security';

const AbortedNavigation = 'ERR_ABORTED';

export function navigationErrorCode(error: unknown): string | number | null {
  if (typeof error !== 'object' || error === null) return null;
  if ('code' in error && typeof error.code === 'string') return error.code;
  if ('errno' in error && typeof error.errno === 'number') return error.errno;
  return null;
}

/** A replacement navigation can reject the initial loadURL promise. It is not
 * an application failure when that replacement still targets our own page. */
export function isSupersededLoadAbort(
  error: unknown,
  initialNavigation: number,
  currentNavigation: number,
  replacementUrl: string,
  entry: string,
): boolean {
  const code = navigationErrorCode(error);
  return (
    (code === AbortedNavigation || code === -3) &&
    currentNavigation > initialNavigation &&
    isTrustedDocument(replacementUrl, entry)
  );
}
