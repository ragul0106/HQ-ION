import { ConfigError, loadConfig } from './config.js';
import { FileSchemeStore, formatProblems } from './eligibility/loader.js';
import { createLogger } from './logger.js';
import { createCallbackSender, createScheduler } from './protocol/callback.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\nSee .env.example.\n`);
      process.exit(1);
    }
    throw err;
  }

  const logger = createLogger(config);

  // Refuse to start with invalid scheme data: a half-valid catalog must never go live.
  const schemes = new FileSchemeStore(config.SCHEMES_DIR);
  const loaded = await schemes.reload();
  if (!loaded.ok) {
    process.stderr.write(
      `Invalid scheme files in ${config.SCHEMES_DIR}:\n${formatProblems(loaded.problems)}\n`,
    );
    process.exit(1);
  }

  // Update schemes without a deploy: edit the files, then `kill -HUP <pid>`. A bad reload keeps the old set.
  process.on('SIGHUP', () => {
    void schemes.reload().then((result) => {
      if (result.ok) {
        logger.info({ schemeCount: result.schemes.length }, 'schemes reloaded');
      } else {
        logger.error(
          { problems: result.problems },
          'scheme reload refused; keeping the previous set',
        );
      }
    });
  });

  const app = buildServer({
    config,
    logger,
    schemes,
    sender: createCallbackSender({ config, log: logger }),
    schedule: createScheduler(logger),
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ host: config.HOST, port: config.PORT });
  logger.info(
    { bppId: config.BPP_ID, networkId: config.NETWORK_ID, schemeCount: loaded.schemes.length },
    'seller app ready',
  );
}

main().catch((err: unknown) => {
  process.stderr.write(
    `fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
