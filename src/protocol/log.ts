import type { Logger } from 'pino';

export interface ProtocolLogEvent {
  /** `in` = a message arrived at us, `out` = a message we sent. */
  direction: 'in' | 'out';
  action: string;
  transactionId?: string;
  messageId?: string;
  bapId?: string;
  bppId?: string;
  outcome: 'received' | 'ack' | 'nack' | 'sent' | 'retry' | 'failed';
  httpStatus?: number;
  errorCode?: string;
  durationMs?: number;
  detail?: string;
}

/**
 * One structured line per protocol message, keyed by transactionId and messageId (PRD W1: "on demo day this is
 * the only thing that will save us"). It takes ids and outcomes only, never a payload, so no personal data can
 * reach the logs through here.
 */
export function logProtocol(log: Logger, event: ProtocolLogEvent): void {
  const level = event.outcome === 'nack' || event.outcome === 'failed' ? 'warn' : 'info';
  log[level](
    { event: 'protocol', ...event },
    `${event.direction} ${event.action} ${event.outcome}`,
  );
}
