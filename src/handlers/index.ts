import { ack, nack } from '../protocol/ack.js';
import {
  UNSUPPORTED_IN_PHASE_1,
  type NotificationAction,
  type RequestAction,
} from '../protocol/actions.js';
import { selectHandler } from './select.js';
import type { Handler } from './types.js';

export type { Handler, HandlerInput, HandlerResult } from './types.js';

/** PRD: scaffold the routes we do not implement and answer with a clear "unsupported", never a silent drop. */
const unsupported: Handler = ({ action, context }) => ({
  status: 400,
  body: nack(
    context.messageId,
    'UNSUPPORTED_IN_PHASE_1',
    `Haqdarshak Phase 1 does not implement '${action}'. Supported: select.`,
  ),
});

/**
 * `on_publish` arrives through the adapter's routing. Its meaning is not yet confirmed with ION, so we
 * acknowledge it and record only the top-level shape (key names, never values) to learn what it carries.
 */
const onPublish: Handler = ({ context, message, deps }) => {
  deps.logger.info(
    {
      event: 'on_publish.shape',
      transactionId: context.transactionId,
      messageKeys: Object.keys(message),
    },
    'on_publish received',
  );
  return { status: 200, body: ack(context.messageId) };
};

export type HandlerMap = Partial<Record<RequestAction | NotificationAction, Handler>>;

export function buildHandlers(): HandlerMap {
  const handlers: HandlerMap = {};
  for (const action of UNSUPPORTED_IN_PHASE_1) handlers[action] = unsupported;
  handlers.select = selectHandler;
  handlers.on_publish = onPublish;
  return handlers;
}
