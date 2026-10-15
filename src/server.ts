import { readFileSync } from 'node:fs';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { AppDeps } from './deps.js';
import { buildHandlers, type HandlerMap } from './handlers/index.js';
import type { Handler } from './handlers/types.js';
import { nack } from './protocol/ack.js';
import { isKnownAction } from './protocol/actions.js';
import { EnvelopeSchema, messageIdOf } from './protocol/context.js';
import { logProtocol } from './protocol/log.js';

const version = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

export interface ServerDeps extends AppDeps {
  /** Override for tests. */
  handlers?: HandlerMap;
}

/**
 * The seller "door": the ONIX seller adapter forwards every verified request to POST /api/webhook/<action>.
 * We answer with an ACK or NACK straight away; real answers go back later through the adapter's /bpp/caller.
 */
export function buildServer({ handlers = buildHandlers(), ...deps }: ServerDeps): FastifyInstance {
  const { config, logger } = deps;
  // We write our own one-line-per-message protocol log (logProtocol), so Fastify's request logging is off.
  const app = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    logController: new LogController({ disableRequestLogging: true }),
  });

  app.get('/health', () => ({
    status: 'ok',
    service: 'hq-ion-seller',
    version,
    ionEnv: config.ION_ENV,
    region: config.DATA_REGION,
  }));

  app.post<{ Params: { action: string } }>('/api/webhook/:action', async (request, reply) => {
    const started = Date.now();
    const { action } = request.params;
    const body: unknown = request.body;

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
      return reply
        .code(400)
        .send(
          nack(messageId, 'BAD_REQUEST', 'Body must contain a valid Beckn context and message.'),
        );
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
      return reply
        .code(400)
        .send(nack(context.messageId, 'ACTION_MISMATCH', `context.action must be '${action}'.`));
    }

    const handler: Handler | undefined = isKnownAction(action) ? handlers[action] : undefined;
    if (!handler) {
      logProtocol(logger, {
        ...identity,
        outcome: 'nack',
        httpStatus: 404,
        errorCode: 'UNKNOWN_ACTION',
      });
      return reply
        .code(404)
        .send(nack(context.messageId, 'UNKNOWN_ACTION', `No handler for '${action}'.`));
    }

    logProtocol(logger, { ...identity, outcome: 'received' });
    const result = await handler({ action, context, message, deps });
    logProtocol(logger, {
      ...identity,
      outcome: result.body.message.status === 'ACK' ? 'ack' : 'nack',
      httpStatus: result.status,
      errorCode: result.body.message.error?.code,
      durationMs: Date.now() - started,
    });
    return reply.code(result.status).send(result.body);
  });

  return app;
}
