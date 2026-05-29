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

  // URL segment stays `:blockerId` for backwards compatibility with clients
  // that hit `DELETE /tickets/:id/dependencies/:blockerId` (the original
  // README routing). The internal service parameter is named `blockedBy` to
  // match the entity field rename.
  @Delete(':blockerId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('blockerId', ParseIntPipe) blockedBy: number,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<void> {
    await this.deps.remove(ticketId, blockedBy, actor.id);
  }
}
