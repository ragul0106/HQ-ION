import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { Controller, Get, Inject } from '@nestjs/common';
import { APP_DEPS } from '../app.tokens.js';
import type { AppDeps } from '../deps.js';

const version = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

@Controller('health')
export class HealthController {
  constructor(@Inject(APP_DEPS) private readonly deps: AppDeps) {}

  @Get()
  check() {
    const { config } = this.deps;
    return {
      status: 'ok',
      service: 'hq-ion-seller',
      version,
      ionEnv: config.ION_ENV,
      region: config.DATA_REGION,
    };
  }
}
