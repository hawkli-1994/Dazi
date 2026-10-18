/** One spelling per native ID, including for the per-work admission gate. */
export function isWorkId(value: unknown): value is string {
  return (
    typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
  );
}
