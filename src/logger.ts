import { pino, type DestinationStream, type Logger } from 'pino';
import type { Config } from './config.js';

/**
 * Keys whose values are personal data (UU PDP) or credentials. Any value under one of these keys is replaced,
 * at any depth, before a log line is written. This is a safety net: the rule is still "never log a payload"
 * (see logProtocol, which logs ids and outcomes only).
 */
const SENSITIVE_KEYS = new Set([
  'msmeprofile',
  'applicantprofile',
  'profile',
  'phone',
  'phonenumber',
  'nik',
  'fullname',
  'dateofbirth',
  'authorization',
  'signature',
  'privatekey',
  'password',
  'token',
]);

const CENSOR = '[REDACTED]';
const MAX_DEPTH = 8;

export function scrub(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return CENSOR;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    if (value instanceof Error) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? CENSOR : scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function createLogger(
  config: Pick<Config, 'LOG_LEVEL' | 'ION_ENV' | 'DATA_REGION'>,
  destination?: DestinationStream,
): Logger {
  const options = {
    level: config.LOG_LEVEL,
    base: { service: 'hq-ion-seller', ionEnv: config.ION_ENV, region: config.DATA_REGION },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      log: (object: Record<string, unknown>) => scrub(object) as Record<string, unknown>,
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
