import 'reflect-metadata';
import { Module, type DynamicModule } from '@nestjs/common';
import { APP_DEPS, HANDLERS } from './app.tokens.js';
import type { AppDeps } from './deps.js';
import { buildHandlers, type HandlerMap } from './handlers/index.js';
import { HealthController } from './http/health.controller.js';
import { WebhookController } from './http/webhook.controller.js';
import { WebhookService } from './http/webhook.service.js';

/**
 * The whole web layer. Everything it needs (settings, logger, scheme store, callback sender, scheduler, handlers)
 * arrives through `register`, so tests can swap any of it, exactly as before.
 */
@Module({})
export class AppModule {
  static register(deps: AppDeps, handlers: HandlerMap = buildHandlers()): DynamicModule {
    return {
      module: AppModule,
      controllers: [WebhookController, HealthController],
      providers: [
        { provide: APP_DEPS, useValue: deps },
        { provide: HANDLERS, useValue: handlers },
        WebhookService,
      ],
    };
  }
}
