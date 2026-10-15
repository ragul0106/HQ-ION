import type { Logger } from 'pino';
import type { Config } from './config.js';
import type { SchemeStore } from './eligibility/loader.js';
import type { CallbackSender, Scheduler } from './protocol/callback.js';

/** Everything the handlers need, in one place, so tests can replace any of it. */
export interface AppDeps {
  config: Config;
  logger: Logger;
  schemes: SchemeStore;
  sender: CallbackSender;
  schedule: Scheduler;
}
