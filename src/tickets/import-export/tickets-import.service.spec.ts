import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TicketsImportService } from './tickets-import.service';
import { TicketsService } from '../tickets.service';
import { ProjectsService } from '../../projects/projects.service';
import { AuditLogService } from '../../audit-log/audit-log.service';

describe('TicketsImportService', () => {
  let service: TicketsImportService;
  let tickets: any;
  let projects: any;
  let audit: any;

  beforeEach(async () => {
    tickets = { create: jest.fn().mockResolvedValue({ id: 1 }) };
    projects = { existsAndActive: jest.fn().mockResolvedValue(true) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        TicketsImportService,
        { provide: TicketsService, useValue: tickets },
        { provide: ProjectsService, useValue: projects },
        { provide: AuditLogService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(TicketsImportService);
  });

  function makeCsv(rows: string[][]): { buffer: Buffer; originalname: string } {
    const csv = rows.map((r) => r.join(',')).join('\n');
    return { buffer: Buffer.from(csv), originalname: 'in.csv' };
  }

  it('rejects missing file with 400', async () => {
    await expect(service.import(1, undefined as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when project is soft-deleted', async () => {
    projects.existsAndActive.mockResolvedValueOnce(false);
    await expect(
      service.import(99, makeCsv([['title', 'description', 'status', 'priority', 'type']])),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('valid rows create tickets; invalid rows are pushed to errors', async () => {
    const file = makeCsv([
      ['title', 'description', 'status', 'priority', 'type'],
      ['good', 'd', 'TODO', 'LOW', 'BUG'],
      ['bad', 'd', 'NOPE', 'LOW', 'BUG'],
    ]);
    const result = await service.import(1, file, 2);
    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0].row).toBe(2);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { created: 1, failed: 1 } }),
    );
  });
});
