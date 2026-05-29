import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

export const IfMatch = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number => {
    const req = ctx.switchToHttp().getRequest();
    const raw = req.headers['if-match'];
    if (!raw || typeof raw !== 'string') {
      throw new HttpException(
        'If-Match header is required',
        HttpStatus.PRECONDITION_REQUIRED,
      );
    }
    const match = raw.match(/^(?:W\/)?"(\d+)"$/);
    if (!match) {
      throw new BadRequestException('Malformed If-Match header');
    }
    return parseInt(match[1], 10);
  },
);
