/**
 * Build the catalog from the scheme files and publish it through the ONIX adapter.
 *   npm run catalog:publish -- --dry-run     print the catalog, send nothing
 *   npm run catalog:publish                  send it
 */
import { buildCatalog } from '../catalog/build.js';
import { assertPublishable, publishCatalog, summarise } from '../catalog/publish.js';
import { ConfigError, loadConfig } from '../config.js';
import { formatProblems, loadSchemes } from '../eligibility/loader.js';

const out = (text: string): void => void process.stdout.write(`${text}\n`);

async function main(): Promise<number> {
  const config = loadConfig();
  const loaded = await loadSchemes(config.SCHEMES_DIR);
  if (!loaded.ok) {
    process.stderr.write(`Invalid scheme files:\n${formatProblems(loaded.problems)}\n`);
    return 1;
  }
  assertPublishable(config, loaded.schemes);
  const catalog = buildCatalog(config, loaded.schemes);

  if (process.argv.includes('--dry-run')) {
    out(JSON.stringify(catalog, null, 2));
    return 0;
  }

  out(
    `publishing ${loaded.schemes.length} schemes to ${config.ADAPTER_PUBLISH_URL} (${config.ION_ENV})`,
  );
  const outcome = await publishCatalog(catalog, { config });
  for (const line of summarise(outcome)) out(line);
  return outcome.httpStatus >= 200 && outcome.httpStatus < 300 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`${err instanceof ConfigError ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
