import 'reflect-metadata';
import { Body, Controller, HttpCode, HttpException, Inject, Param, Post } from '@nestjs/common';
import type { AckBody } from '../protocol/ack.js';
import { WebhookService } from './webhook.service.js';

/** POST /api/webhook/:action, the door ONIX calls. Success is an ACK (200); a refusal is a NACK with its own status. */
@Controller('api/webhook')
export class WebhookController {
  constructor(@Inject(WebhookService) private readonly webhook: WebhookService) {}

  @Post(':action')
  @HttpCode(200)
  async receive(@Param('action') action: string, @Body() body: unknown): Promise<AckBody> {
    const result = await this.webhook.process(action, body);
    // A NACK is sent exactly as built (same JSON body) with its status; Nest sends an object response as-is.
    if (result.status >= 400) throw new HttpException(result.body, result.status);
    return result.body;
  }
}
