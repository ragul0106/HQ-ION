import type { LoggerService } from '@nestjs/common';
import type { Logger } from 'pino';

/**
 * Sends NestJS's own messages (start-up, routes, internal errors) to our pino logger. Nest's routine messages go to
 * debug level, so at the default `info` level the log holds only our protocol lines, warnings and errors.
 */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly pino: Logger) {}

  log(message: unknown, context?: string): void {
    this.pino.debug({ nest: context }, String(message));
  }
  verbose(message: unknown, context?: string): void {
    this.pino.debug({ nest: context }, String(message));
  }
  debug(message: unknown, context?: string): void {
    this.pino.debug({ nest: context }, String(message));
  }
  warn(message: unknown, context?: string): void {
    this.pino.warn({ nest: context }, String(message));
  }
  error(message: unknown, trace?: string, context?: string): void {
    this.pino.error({ nest: context, trace }, String(message));
  }
  fatal(message: unknown, context?: string): void {
    this.pino.fatal({ nest: context }, String(message));
  }
}
