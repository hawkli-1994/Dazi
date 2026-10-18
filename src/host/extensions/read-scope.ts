import { isAbsolute, relative, sep } from 'node:path';
import type { Context } from '@earendil-works/chord';
import {
  err,
  FileError,
  getOrThrow,
  ok,
  type ExecutionEnv,
  type Result,
} from '@earendil-works/pi-durable/env';

export function isWithinWorkDirectory(directory: string, path: string): boolean {
  const difference = relative(directory, path);
  return (
    difference === '' ||
    (!isAbsolute(difference) && difference !== '..' && !difference.startsWith(`..${sep}`))
  );
}

/**
 * A guard for the native read tool, not an OS sandbox. Check both lexical and real
 * paths, including the native tool's filename fallbacks, immediately before open.
 * O_NOFOLLOW also rejects a replaced final symlink on platforms that support it.
 * A hostile process changing ancestor directories concurrently requires OS isolation.
 */
export async function restrictReadEnvironment(
  env: ExecutionEnv,
  directory: string,
  context: Context,
): Promise<ExecutionEnv> {
  const selected = getOrThrow(await env.absolutePath(directory, context));
  const root = getOrThrow(await env.canonicalPath(selected, context));

  const checkedPath = async (
    path: string,
    current: Context,
  ): Promise<Result<string, FileError>> => {
    current.abortSignal?.throwIfAborted();
    const absolute = await env.absolutePath(path, current);
    if (!absolute.ok) return absolute;
    if (
      !isWithinWorkDirectory(selected, absolute.value) &&
      !isWithinWorkDirectory(root, absolute.value)
    ) {
      return denied(absolute.value);
    }
    const canonical = await env.canonicalPath(absolute.value, current);
    if (!canonical.ok) return canonical;
    return isWithinWorkDirectory(root, canonical.value) ? canonical : denied(absolute.value);
  };

  // Inherit the environment's implementation without spreading away its methods.
  // Only these three methods are used by native read in pi-durable 1.3.0.
  const guarded = Object.create(env) as ExecutionEnv;
  guarded.absolutePath = async (path, current) => {
    const absolute = await env.absolutePath(path, current);
    if (!absolute.ok) return absolute;
    return isWithinWorkDirectory(selected, absolute.value) ||
      isWithinWorkDirectory(root, absolute.value)
      ? absolute
      : denied(absolute.value);
  };
  guarded.exists = async (path, current) => {
    const checked = await checkedPath(path, current);
    if (!checked.ok) return checked.error.code === 'not_found' ? ok(false) : checked;
    return env.exists(checked.value, current);
  };
  guarded.openBinaryReader = async (path, options, current) => {
    const checked = await checkedPath(path, current);
    if (!checked.ok) return checked;
    return env.openBinaryReader(checked.value, { ...options, noFollow: true }, current);
  };
  return guarded;
}

function denied(path: string): Result<never, FileError> {
  return err(
    new FileError(
      'permission_denied',
      'Reading outside the selected work directory is not allowed.',
      path,
    ),
  );
}
