/**
 * Ask the seller, through ION's buyer adapter, which schemes an MSME qualifies for.
 *   npm run ask -- --sector food --province "Jawa Tengah" --workers 3 --turnover 300000000 --nib yes --export no
 *   npm run ask -- --help
 *
 * Needs the testnet running, `npm run onix:apply` done, and the seller app running (npm start).
 */
import { loadConfig } from '../src/config.js';
import { AskArgError, formatReply, HELP, parseAskArgs } from './ask-lib.js';
import { askSeller, buyerEnv, listen, startBuyer } from './buyer-client.js';

const out = (text: string): void => void process.stdout.write(`${text}\n`);

async function main(): Promise<number> {
  const args = parseAskArgs(process.argv.slice(2));
  if (args.help) {
    out(HELP);
    return 0;
  }

  const config = loadConfig();
  const bap = buyerEnv();
  const buyer = startBuyer();
  try {
    await listen(buyer, bap.port);
  } catch {
    process.stderr.write(`Cannot listen on :${bap.port} (is another test buyer running?)\n`);
    return 1;
  }

  const answered = Object.keys(args.profile).length;
  out(
    `Asking ${config.BPP_ID} (${answered} answer${answered === 1 ? '' : 's'}) through ${bap.callerUrl} ...`,
  );
  const result = await askSeller({
    profile: args.profile,
    language: args.language,
    config,
    bap,
    buyer,
    onNote: (note) => out(`  ${note}`),
  });
  buyer.close();

  if (!result.ok) {
    process.stderr.write(`\nNo answer: ${result.reason}\n`);
    return 1;
  }
  out(`Answer received in ${result.ms} ms.\n`);
  for (const line of formatReply(result.reply, args.language, answered)) out(line);
  if (args.json) out(`\n${JSON.stringify(result.reply.message, null, 2)}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    if (err instanceof AskArgError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(2);
    }
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
