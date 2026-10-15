import { eligibleSchemes, stillUnknownFields } from '../eligibility/engine.js';
import { ack, nack } from '../protocol/ack.js';
import { buildOnSelectMessage, parseSelect } from '../wire/select.js';
import type { Handler } from './types.js';

/**
 * `select`: the buyer sends an MSME profile; we answer with the schemes it qualifies for.
 *
 * Two steps, as Beckn requires:
 *   1. now: check the request, reply ACK (or NACK if it is malformed)
 *   2. afterwards: run the rules and send `on_select` through the adapter
 *
 * The profile is used and dropped. It is never stored and never logged (only how many questions were answered).
 */
export const selectHandler: Handler = ({ context, message, deps }) => {
  const parsed = parseSelect(message);
  if (!parsed.ok) {
    return {
      status: 400,
      body: nack(context.messageId, 'BAD_REQUEST', `Invalid select. ${parsed.problems.join('; ')}`),
    };
  }
  const request = parsed.value;

  deps.schedule(async () => {
    const schemes = deps.schemes.all();
    const eligible = eligibleSchemes(schemes, request.profile);
    const stillUnknown = stillUnknownFields(schemes, request.profile);
    deps.logger.info(
      {
        event: 'select.evaluated',
        transactionId: context.transactionId,
        messageId: context.messageId,
        schemesChecked: schemes.length,
        eligibleCount: eligible.length,
        answeredFields: Object.keys(request.profile).length,
      },
      'eligibility evaluated',
    );
    await deps.sender.send(
      'select',
      context,
      buildOnSelectMessage({ config: deps.config, request, eligible, stillUnknown }),
    );
  });

  return { status: 200, body: ack(context.messageId) };
};
