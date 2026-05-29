import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TicketsCsvService } from './tickets-csv.service';
import { TicketsService } from '../tickets.service';
import { ProjectsService } from '../../projects/projects.service';
import { AuditLogService } from '../../audit-log/audit-log.service';

describe('TicketsCsvService', () => {
  let service: TicketsCsvService;
  let tickets: any;
  let projects: any;
  let audit: any;

  beforeEach(async () => {
    tickets = {
      findAllForProject: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 1 }),
    };
    projects = { existsAndActive: jest.fn().mockResolvedValue(true) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        TicketsCsvService,
        { provide: TicketsService, useValue: tickets },
        { provide: ProjectsService, useValue: projects },
        { provide: AuditLogService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(TicketsCsvService);
  });

  function makeCsv(rows: string[][]): { buffer: Buffer; originalname: string } {
    const csv = rows.map((r) => r.join(',')).join('\n');
    return { buffer: Buffer.from(csv), originalname: 'in.csv' };
  }

  describe('export', () => {
    it('throws when project is soft-deleted', async () => {
      projects.existsAndActive.mockResolvedValueOnce(false);
      await expect(service.export(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('emits RFC 4180 quoted CSV including commas in titles', async () => {
      tickets.findAllForProject.mockResolvedValueOnce([
        {
          id: 1,
          title: 'title, with comma',
          description: 'has "quotes"',
          status: 'TODO',
          priority: 'LOW',
          type: 'BUG',
          assigneeId: 7,
        },
      ]);
      const csv = await service.export(1, 5);
      expect(csv).toContain('"title, with comma"');
      expect(csv).toContain('"has ""quotes"""');
      expect(csv.split('\n')[0]).toContain('"id"');
      expect(csv.split('\n')[0]).toContain('"assigneeId"');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { event: 'export', ticketCount: 1 },
        }),
      );
    });
  });

  describe('import', () => {
    it('rejects when project is soft-deleted', async () => {
      projects.existsAndActive.mockResolvedValueOnce(false);
      await expect(
        service.import(
          99,
          makeCsv([['title', 'description', 'status', 'priority', 'type']]),
        ),
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
      // Header is line 1, good row is line 2, bad row is line 3 in the file.
      expect(result.errors[0].row).toBe(3);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { event: 'import', created: 1, failed: 1 },
        }),
      );
    });
  });
});
