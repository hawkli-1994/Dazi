export const HostErrorCode = {
  InvalidInput: 'INVALID_INPUT',
  WorkNotFound: 'WORK_NOT_FOUND',
  WorkArchived: 'WORK_ARCHIVED',
  DirectoryInvalid: 'DIRECTORY_INVALID',
  ModelMissing: 'MODEL_NOT_CONFIGURED',
  ModelUnknown: 'MODEL_NOT_AVAILABLE',
  ModelAuthMissing: 'MODEL_AUTH_MISSING',
  DecisionNotPending: 'DECISION_NOT_PENDING',
  NoteMissing: 'NOTE_NOT_FOUND',
  OperationFailed: 'HOST_OPERATION_FAILED',
  ConnectionClosed: 'CONNECTION_CLOSED',
} as const;

export class HostError extends Error {
  constructor(code: (typeof HostErrorCode)[keyof typeof HostErrorCode]) {
    super(code);
    this.name = 'HostError';
  }
}

/** Do not reflect provider errors, filesystem details, or credentials into transport errors. */
export function publicError(error: unknown): string {
  return error instanceof HostError ? error.message : HostErrorCode.OperationFailed;
}

export function requireText(value: unknown, maxLength = 100_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new HostError(HostErrorCode.InvalidInput);
  }
  return value.trim();
}
