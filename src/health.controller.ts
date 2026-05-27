import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class HealthController {
  @Public()
  @Get()
  health(): { status: string } {
    return { status: 'ok' };
  }
}
