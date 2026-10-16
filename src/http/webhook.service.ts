import 'reflect-metadata';
import { Inject, Injectable } from '@nestjs/common';
import { APP_DEPS, HANDLERS } from '../app.tokens.js';
import type { AppDeps } from '../deps.js';
import type { HandlerMap } from '../handlers/index.js';
import type { Handler, HandlerResult } from '../handlers/types.js';
import { nack } from '../protocol/ack.js';
import { isKnownAction } from '../protocol/actions.js';
import { EnvelopeSchema, messageIdOf } from '../protocol/context.js';
import { logProtocol } from '../protocol/log.js';

/**
 * The seller "door", as a service: the ONIX seller adapter forwards every verified request to
 * POST /api/webhook/<action>. This checks the message, picks the handler, logs one line per message, and returns the
 * ACK or NACK to send straight back. Real answers go back later through the adapter's /bpp/caller.
 */
@Injectable()
export class WebhookService {
  constructor(
    @Inject(APP_DEPS) private readonly deps: AppDeps,
    @Inject(HANDLERS) private readonly handlers: HandlerMap,
  ) {}

  async process(action: string, body: unknown): Promise<HandlerResult> {
    const { logger } = this.deps;
    const started = Date.now();

    const parsed = EnvelopeSchema.safeParse(body);
    if (!parsed.success) {
      const messageId = messageIdOf(body);
      logProtocol(logger, {
        direction: 'in',
        action,
        messageId,
        outcome: 'nack',
        httpStatus: 400,
        errorCode: 'BAD_REQUEST',
        detail: parsed.error.issues.map((i) => i.path.join('.')).join(', '),
      });
      return {
        status: 400,
        body: nack(
          messageId,
          'BAD_REQUEST',
          'Body must contain a valid Beckn context and message.',
        ),
      };
    }

    const { context, message } = parsed.data;
    const identity = {
      direction: 'in' as const,
      action,
      transactionId: context.transactionId,
      messageId: context.messageId,
      bapId: context.bapId,
      bppId: context.bppId,
    };

    if (context.action !== action) {
      logProtocol(logger, {
        ...identity,
        outcome: 'nack',
        httpStatus: 400,
        errorCode: 'ACTION_MISMATCH',
      });
      return {
        status: 400,
        body: nack(context.messageId, 'ACTION_MISMATCH', `context.action must be '${action}'.`),
      };
    }

    const handler: Handler | undefined = isKnownAction(action) ? this.handlers[action] : undefined;
    if (!handler) {
      logProtocol(logger, {
        ...identity,
        outcome: 'nack',
        httpStatus: 404,
        errorCode: 'UNKNOWN_ACTION',
      });
      return {
        status: 404,
        body: nack(context.messageId, 'UNKNOWN_ACTION', `No handler for '${action}'.`),
      };
    }

    logProtocol(logger, { ...identity, outcome: 'received' });
    const result = await handler({ action, context, message, deps: this.deps });
    logProtocol(logger, {
      ...identity,
      outcome: result.body.message.status === 'ACK' ? 'ack' : 'nack',
      httpStatus: result.status,
      errorCode: result.body.message.error?.code,
      durationMs: Date.now() - started,
    });
    return result;
  }
}
