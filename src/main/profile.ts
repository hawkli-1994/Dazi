import { isAbsolute } from 'node:path';

const ProfileArgument = '--dazi-user-data=';

/** An explicit profile keeps trial builds and automated checks away from personal work. */
export function userDataDirectory(argv: string[]): string | undefined {
  const overrides = argv.filter((argument) => argument.startsWith(ProfileArgument));
  if (overrides.length === 0) return undefined;
  const path = overrides[0].slice(ProfileArgument.length);
  if (overrides.length !== 1 || !isAbsolute(path) || path.includes('\0')) {
    throw new Error('Specify exactly one absolute --dazi-user-data directory.');
  }
  return path;
}
