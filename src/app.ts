import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import type { AppDeps } from './deps.js';
import type { HandlerMap } from './handlers/index.js';
import { PinoNestLogger } from './http/pino-nest-logger.js';

/**
 * Build the NestJS application on the Fastify adapter. Fastify's own request log is off (`logger: false`):
 * we write one structured line per protocol message ourselves (logProtocol).
 */
export async function createApp(
  deps: AppDeps,
  handlers?: HandlerMap,
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(deps, handlers),
    new FastifyAdapter({ logger: false }),
    // abortOnError false: a failure to start throws, instead of ending the process (tests need that)
    { logger: new PinoNestLogger(deps.logger), abortOnError: false },
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
