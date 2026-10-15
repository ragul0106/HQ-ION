import { z } from 'zod';

/**
 * All configuration comes from environment variables (PRD W1/W5: nothing about an environment, a region or a
 * credential is hardcoded). Signing keys are NOT configured here: they belong to the ONIX adapter.
 */
const schema = z.object({
  /** Required, no default: running against the live network must always be a deliberate act. */
  ION_ENV: z.enum(['sandbox', 'pilot', 'live']),
  /** Where personal data would live. Recorded on every log line so a migration to Indonesia is visible. */
  DATA_REGION: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(3102),
  HOST: z.string().min(1).default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  NETWORK_ID: z.string().min(1),
  BPP_ID: z.string().min(1),
  BPP_URI: z.url(),
  ADAPTER_CALLER_URL: z.url(),
  ADAPTER_PUBLISH_URL: z.url(),
  SCHEMES_DIR: z.string().min(1).default('./data/schemes'),
  /**
   * Where the JSON-LD contexts named in our messages are served from. TEMPORARY: these are our own stand-in
   * schemas until ION's government-benefits schema is confirmed. The ONIX adapter downloads them at validation
   * time, so the host must be on its allow-list (see deploy/onix).
   */
  SCHEMA_BASE_URL: z.url().default('http://reverse-proxy:9000/schema'),
});

export type Config = z.infer<typeof schema>;

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/** Parse and validate an environment. Never echoes a received value, only the variable name and the rule. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}
