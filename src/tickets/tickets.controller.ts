import {
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseFilePipe,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketResponseDto } from './dto/ticket-response.dto';
import { TicketDeletedResponseDto } from './dto/ticket-deleted-response.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';
import { IfMatch } from '../common/decorators/if-match.decorator';
import {
  TicketsCsvService,
  ImportResult,
} from './import-export/tickets-csv.service';

const MAX_IMPORT_SIZE = 10 * 1024 * 1024;

@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly csvSvc: TicketsCsvService,
  ) {}

  // Static segments are declared before `:ticketId` so they aren't shadowed
  // by Express's route trie (registration order matters here).
  @Get('deleted')
  @Roles(UserRole.ADMIN)
  async listDeleted(
    @Query('projectId', ParseIntPipe) projectId: number,
  ): Promise<TicketDeletedResponseDto[]> {
    const rows = await this.tickets.findAllDeletedForProject(projectId);
    return rows.map(TicketDeletedResponseDto.fromEntity);
  }

  @Get('export')
  async export(
    @Query('projectId', ParseIntPipe) projectId: number,
    @CurrentUser() actor: CurrentUserPayload,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await this.csvSvc.export(projectId, actor.id);
    res
      .status(HttpStatus.OK)
      .header('Content-Type', 'text/csv')
      .header(
        'Content-Disposition',
        `attachment; filename="tickets-${projectId}.csv"`,
      )
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
    @UploadedFile(
      new ParseFilePipe({
        fileIsRequired: true,
        validators: [
          new FileTypeValidator({
            fileType: /^text\/csv$/,
            skipMagicNumbersValidation: true,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body('projectId', ParseIntPipe) projectId: number,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<ImportResult> {
    return this.csvSvc.import(projectId, file, actor.id);
  }

  @Get()
  async list(
    @Query('projectId', ParseIntPipe) projectId: number,
  ): Promise<TicketResponseDto[]> {
    const rows = await this.tickets.findAllForProject(projectId);
    return rows.map(TicketResponseDto.fromEntity);
  }

  @Get(':ticketId')
  async get(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TicketResponseDto> {
    const ticket = await this.tickets.findOne(ticketId);
    // Single-ticket reads must emit the ETag so clients can pick up the
    // current version for subsequent If-Match writes. The interceptor only
    // sees the DTO (no `version`), so we set the header explicitly here.
    res.setHeader('ETag', `W/"${ticket.version}"`);
    return TicketResponseDto.fromEntity(ticket);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async create(
    @Body() dto: CreateTicketDto,
    @CurrentUser() actor: CurrentUserPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TicketResponseDto> {
    const ticket = await this.tickets.create(dto, actor.id);
    res.setHeader('ETag', `W/"${ticket.version}"`);
    return TicketResponseDto.fromEntity(ticket);
  }

  @Patch(':ticketId')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() dto: UpdateTicketDto,
    @CurrentUser() actor: CurrentUserPayload,
    @IfMatch() expectedVersion: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    // README documents an empty 200 body; the new version is conveyed
    // exclusively via the `ETag` header so clients can use it for the next
    // If-Match round-trip. We set the header manually because the global
    // ETagInterceptor only fires when the body itself carries `version`.
    const saved = await this.tickets.update(
      ticketId,
      dto,
      actor.id,
      expectedVersion,
    );
    res.setHeader('ETag', `W/"${saved.version}"`);
  }

  @Delete(':ticketId')
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @CurrentUser() actor: CurrentUserPayload,
    @IfMatch() expectedVersion: number,
  ): Promise<void> {
    await this.tickets.softDelete(ticketId, actor.id, expectedVersion);
  }

  @Post(':ticketId/restore')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  async restore(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @CurrentUser() actor: CurrentUserPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    // Post-restore version is the canonical fresh version a follow-up
    // PATCH/DELETE must match against. Empty body per README; ETag header
    // carries the version manually because the global interceptor expects
    // a body object with a numeric `version` to fire.
    const restored = await this.tickets.restore(ticketId, actor.id);
    res.setHeader('ETag', `W/"${restored.version}"`);
  }
}
