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

@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  // Static segments are declared before `:ticketId` so they are not shadowed
  // (route order matters in Express).
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
  create(@Body() dto: CreateTicketDto): Promise<Ticket> {
    return this.tickets.create(dto);
  }

  @Patch(':ticketId')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() dto: UpdateTicketDto,
  ): Promise<Ticket> {
    return this.tickets.update(ticketId, dto);
  }

  @Delete(':ticketId')
  @HttpCode(HttpStatus.OK)
  async delete(@Param('ticketId', ParseIntPipe) ticketId: number): Promise<void> {
    await this.tickets.softDelete(ticketId);
  }

  @Post(':ticketId/restore')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  restore(@Param('ticketId', ParseIntPipe) ticketId: number): Promise<Ticket> {
    return this.tickets.restore(ticketId);
  }
}
