import type { Logger } from 'pino';
import type { Config } from '../config.js';
import type { Context } from './context.js';
import { logProtocol } from './log.js';

/** Sends an `on_<action>` answer back through our ONIX adapter, which signs it and forwards it to the buyer. */
export interface CallbackSender {
  send(action: string, requestContext: Context, message: unknown): Promise<void>;
}

/** Runs work after the ACK has gone out. Injected so tests can wait for it. */
export type Scheduler = (task: () => Promise<void>) => void;

export function createScheduler(log: Logger): Scheduler {
  return (task) => {
    void task().catch((err: unknown) => {
      log.error({ err }, 'background task failed');
    });
  };
}

export class CallbackError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'CallbackError';
  }
}

export interface SenderOptions {
  config: Pick<Config, 'ADAPTER_CALLER_URL'>;
  log: Logger;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Total tries, including the first. */
  maxAttempts?: number;
  timeoutMs?: number;
  backoffMs?: number;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry rules (PRD W1: "timeouts and retries"):
 *   - network error, timeout or HTTP 5xx: try again, waiting 0.5 s, 1 s, 2 s ...
 *   - HTTP 4xx: give up at once. The adapter has told us the message itself is wrong (schema, signature), and
 *     sending the same thing again cannot help.
 * The reply keeps the request's transactionId and messageId (that is how the buyer matches answer to question);
 * only the action and the timestamp change.
 */
export function createCallbackSender(options: SenderOptions): CallbackSender {
  const {
    config,
    log,
    fetchFn = fetch,
    sleep = realSleep,
    maxAttempts = 4,
    timeoutMs = 30_000,
    backoffMs = 500,
  } = options;

  return {
    async send(action, requestContext, message) {
      const callbackAction = `on_${action}`;
      const context = {
        ...requestContext,
        action: callbackAction,
        timestamp: new Date().toISOString(),
      };
      const body = JSON.stringify({ context, message });
      const url = `${config.ADAPTER_CALLER_URL.replace(/\/$/, '')}/${callbackAction}`;
      const identity = {
        direction: 'out' as const,
        action: callbackAction,
        transactionId: context.transactionId,
        messageId: context.messageId,
        bapId: context.bapId,
        bppId: context.bppId,
      };

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const started = Date.now();
        let status: number | undefined;
        let errorCode: string | undefined;
        try {
          const res = await fetchFn(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
            signal: AbortSignal.timeout(timeoutMs),
          });
          status = res.status;
          if (res.ok) {
            logProtocol(log, {
              ...identity,
              outcome: 'sent',
              httpStatus: status,
              durationMs: Date.now() - started,
            });
            return;
          }
          errorCode = await readErrorCode(res);
        } catch (err) {
          errorCode = err instanceof Error ? err.name : 'NETWORK_ERROR';
        }

        const retryable = status === undefined || status >= 500;
        if (!retryable) {
          logProtocol(log, {
            ...identity,
            outcome: 'failed',
            httpStatus: status,
            errorCode,
            detail: 'not retried',
          });
          throw new CallbackError(
            `${callbackAction} refused by the adapter (HTTP ${status}, ${errorCode ?? 'no code'})`,
            status,
          );
        }
        if (attempt === maxAttempts) {
          logProtocol(log, {
            ...identity,
            outcome: 'failed',
            httpStatus: status,
            errorCode,
            detail: `gave up after ${attempt} tries`,
          });
          throw new CallbackError(`${callbackAction} not delivered after ${attempt} tries`, status);
        }
        logProtocol(log, {
          ...identity,
          outcome: 'retry',
          httpStatus: status,
          errorCode,
          detail: `try ${attempt} of ${maxAttempts}`,
        });
        await sleep(backoffMs * 2 ** (attempt - 1));
      }
    },
  };
}

async function readErrorCode(res: Response): Promise<string | undefined> {
  try {
    const json = (await res.json()) as { message?: { error?: { code?: unknown } } };
    const code = json.message?.error?.code;
    return typeof code === 'string' ? code : undefined;
  } catch {
    return undefined;
  }
}
