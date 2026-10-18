import { describe, expect, it } from 'vitest';
import { isSupersededLoadAbort } from './navigation';
import { AppEntry } from './security';

describe('initial window load failure', () => {
  it('does not quit when a reload supersedes the initial trusted navigation', () => {
    expect(isSupersededLoadAbort({ code: 'ERR_ABORTED' }, 1, 2, AppEntry, AppEntry)).toBe(true);
    expect(isSupersededLoadAbort({ errno: -3 }, 1, 2, `${AppEntry}#/work/1`, AppEntry)).toBe(true);
  });

  it('does not swallow genuine failures, unsuperseded aborts, or external navigation', () => {
    expect(isSupersededLoadAbort({ code: 'ERR_FILE_NOT_FOUND' }, 1, 2, AppEntry, AppEntry)).toBe(
      false,
    );
    expect(isSupersededLoadAbort({ code: 'ERR_FAILED' }, 1, 2, AppEntry, AppEntry)).toBe(false);
    expect(isSupersededLoadAbort({ code: 'ERR_ABORTED' }, 1, 1, AppEntry, AppEntry)).toBe(false);
    expect(
      isSupersededLoadAbort({ code: 'ERR_ABORTED' }, 1, 2, 'https://example.com/', AppEntry),
    ).toBe(false);
    expect(isSupersededLoadAbort(new Error('Unexpected failure'), 1, 2, AppEntry, AppEntry)).toBe(
      false,
    );
  });
});
