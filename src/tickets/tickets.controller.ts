import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { Ticket } from './entities/ticket.entity';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get('deleted')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  listDeleted(@Query('projectId', ParseIntPipe) projectId: number): Promise<Ticket[]> {
    return this.tickets.findAllDeletedForProject(projectId);
  }

  @Get()
  list(@Query('projectId', ParseIntPipe) projectId: number): Promise<Ticket[]> {
    return this.tickets.findAllForProject(projectId);
  }

  @Get(':ticketId')
  get(@Param('ticketId', ParseIntPipe) ticketId: number): Promise<Ticket> {
    return this.tickets.findOne(ticketId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  create(
    @Body() dto: CreateTicketDto,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<Ticket> {
    return this.tickets.create(dto, actor?.id ?? null);
  }

  @Patch(':ticketId')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() dto: UpdateTicketDto,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<Ticket> {
    return this.tickets.update(ticketId, dto, actor?.id ?? null);
  }

  @Delete(':ticketId')
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<void> {
    await this.tickets.softDelete(ticketId, actor?.id ?? null);
  }

  @Post(':ticketId/restore')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  restore(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<Ticket> {
    return this.tickets.restore(ticketId, actor?.id ?? null);
  }
}
