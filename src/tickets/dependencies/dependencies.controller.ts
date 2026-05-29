import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { DependenciesService } from './dependencies.service';
import { AddDependencyDto } from './dto/add-dependency.dto';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../../common/decorators/current-user.decorator';

@Controller('tickets/:ticketId/dependencies')
export class DependenciesController {
  constructor(private readonly deps: DependenciesService) {}

  @Get()
  list(@Param('ticketId', ParseIntPipe) ticketId: number) {
    return this.deps.list(ticketId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async add(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() dto: AddDependencyDto,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<void> {
    await this.deps.add(ticketId, dto.blockedBy, actor.id);
  }

  @Delete(':blockerId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('blockerId', ParseIntPipe) blockerId: number,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<void> {
    await this.deps.remove(ticketId, blockerId, actor.id);
  }
}
