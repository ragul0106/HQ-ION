import type { AppDeps } from '../deps.js';
import type { AckBody } from '../protocol/ack.js';
import type { Context } from '../protocol/context.js';

export interface HandlerInput {
  action: string;
  context: Context;
  message: Record<string, unknown>;
  deps: AppDeps;
}

export interface HandlerResult {
  status: number;
  body: AckBody;
}

export type Handler = (input: HandlerInput) => HandlerResult | Promise<HandlerResult>;
