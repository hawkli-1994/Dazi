import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { userDataDirectory } from './profile';

describe('explicit desktop profile', () => {
  it('preserves the default profile unless a directory was explicitly provided', () => {
    expect(userDataDirectory(['app', '--test-provider'])).toBeUndefined();
    const path = resolve('temporary trial profile');
    expect(userDataDirectory(['app', `--dazi-user-data=${path}`])).toBe(path);
  });

  it('rejects ambiguous or relative profiles before opening personal storage', () => {
    for (const args of [
      ['--dazi-user-data='],
      ['--dazi-user-data=relative'],
      [`--dazi-user-data=${resolve('one')}`, `--dazi-user-data=${resolve('two')}`],
      [`--dazi-user-data=${resolve('invalid')}\0`],
    ])
      expect(() => userDataDirectory(args)).toThrow('absolute --dazi-user-data');
  });
});
