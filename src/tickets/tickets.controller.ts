import {
  BadRequestException,
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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { Ticket } from './entities/ticket.entity';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { TicketsExportService } from './import-export/tickets-export.service';
import { TicketsImportService, ImportResult } from './import-export/tickets-import.service';

const MAX_IMPORT_SIZE = 10 * 1024 * 1024;

@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly exportSvc: TicketsExportService,
    private readonly importSvc: TicketsImportService,
  ) {}

  // Static segments are declared before `:ticketId` so they aren't shadowed
  // by Express's route trie (registration order matters here).
  @Get('deleted')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  listDeleted(@Query('projectId', ParseIntPipe) projectId: number): Promise<Ticket[]> {
    return this.tickets.findAllDeletedForProject(projectId);
  }

  @Get('export')
  async export(
    @Query('projectId', ParseIntPipe) projectId: number,
    @CurrentUser() actor: CurrentUserPayload,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await this.exportSvc.export(projectId, actor?.id ?? null);
    res
      .status(HttpStatus.OK)
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', `attachment; filename="tickets-${projectId}.csv"`)
      .send(csv);
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMPORT_SIZE },
    }),
  )
  async import(
    @UploadedFile() file: Express.Multer.File,
    @Body('projectId') projectIdRaw: string,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<ImportResult> {
    const projectId = parseInt(projectIdRaw, 10);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      throw new BadRequestException('projectId must be a positive integer');
    }
    return this.importSvc.import(projectId, file, actor?.id ?? null);
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
