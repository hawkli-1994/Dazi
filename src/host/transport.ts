import { Command, Wire, type ClientMessage, type Request } from '../shared/rpc/protocol';
import { HostError, HostErrorCode } from './errors';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown, max = 100_000): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}
export function isSubscriptionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

/** This is validation of the transport envelope, not a second conversation format. */
export function parseClientMessage(value: unknown): ClientMessage {
  if (!record(value)) throw new HostError(HostErrorCode.InvalidInput);
  if (
    value.type === Wire.Ack &&
    isSubscriptionId(value.subscriptionId) &&
    Number.isSafeInteger(value.sequence) &&
    Number(value.sequence) >= 0
  ) {
    return {
      type: Wire.Ack,
      subscriptionId: value.subscriptionId,
      sequence: Number(value.sequence),
    };
  }
  if (value.type !== Wire.Request || !text(value.id, 200) || !record(value.input))
    throw new HostError(HostErrorCode.InvalidInput);
  const input = value.input;
  const work = () => text(input.workId, 100);
  let valid = false;
  switch (value.command) {
    case Command.ListWorks:
    case Command.ListModels:
      valid = true;
      break;
    case Command.CreateWork:
      valid = text(input.goal, 20_000) && text(input.directory, 4000) && text(input.requestId, 200);
      break;
    case Command.SubscribeWork:
      valid = work() && isSubscriptionId(input.subscriptionId);
      break;
    case Command.Submit:
      valid =
        work() &&
        text(input.text) &&
        text(input.requestId, 200) &&
        (input.whenBusy === undefined ||
          input.whenBusy === 'followUp' ||
          input.whenBusy === 'steer');
      break;
    case Command.Abort:
    case Command.Archive:
      valid = work();
      break;
    case Command.UpdateDossier:
      valid = work() && text(input.noteId, 200) && text(input.text, 4000);
      break;
    case Command.ResolveDecision:
      valid = work() && text(input.decisionId, 200) && typeof input.approved === 'boolean';
      break;
    case Command.SetSchedule:
      valid =
        work() &&
        record(input.schedule) &&
        typeof input.schedule.enabled === 'boolean' &&
        typeof input.schedule.prompt === 'string' &&
        text(input.schedule.time, 5) &&
        text(input.schedule.frequency, 10);
      break;
    case Command.ConfigureModel:
      valid =
        text(input.provider, 100) &&
        text(input.modelId, 200) &&
        (input.workId === undefined || work());
      break;
  }
  if (!valid) throw new HostError(HostErrorCode.InvalidInput);
  return value as Request;
}
