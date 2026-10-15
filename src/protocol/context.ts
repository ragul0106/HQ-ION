import { z } from 'zod';

/**
 * The Beckn `context` block that travels with every message. We require only what we depend on and let
 * everything else through unchanged (the ONIX adapter has already verified the signature and the schema).
 */
export const ContextSchema = z.looseObject({
  action: z.string().min(1),
  version: z.string().min(1),
  transactionId: z.string().min(1),
  messageId: z.string().min(1),
  timestamp: z.string().min(1),
  networkId: z.string().optional(),
  bapId: z.string().optional(),
  bapUri: z.string().optional(),
  bppId: z.string().optional(),
  bppUri: z.string().optional(),
  ttl: z.string().optional(),
});

export type Context = z.infer<typeof ContextSchema>;

export const EnvelopeSchema = z.object({
  context: ContextSchema,
  message: z.record(z.string(), z.unknown()).default({}),
});

export type Envelope = z.infer<typeof EnvelopeSchema>;

/** Best-effort messageId for an error reply when the body did not validate. */
export function messageIdOf(body: unknown): string {
  if (body && typeof body === 'object' && 'context' in body) {
    const ctx = (body as { context?: unknown }).context;
    if (ctx && typeof ctx === 'object' && 'messageId' in ctx) {
      const id = (ctx as { messageId?: unknown }).messageId;
      if (typeof id === 'string' && id.length > 0) return id;
    }
  }
  return 'unknown';
}
