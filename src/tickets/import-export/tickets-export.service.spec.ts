import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TicketsExportService } from './tickets-export.service';
import { TicketsService } from '../tickets.service';
import { ProjectsService } from '../../projects/projects.service';
import { AuditLogService } from '../../audit-log/audit-log.service';

describe('TicketsExportService', () => {
  let service: TicketsExportService;
  let tickets: any;
  let projects: any;
  let audit: any;

  beforeEach(async () => {
    tickets = { findAllForProject: jest.fn().mockResolvedValue([]) };
    projects = { existsAndActive: jest.fn().mockResolvedValue(true) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        TicketsExportService,
        { provide: TicketsService, useValue: tickets },
        { provide: ProjectsService, useValue: projects },
        { provide: AuditLogService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(TicketsExportService);
  });

  it('throws when project is soft-deleted', async () => {
    projects.existsAndActive.mockResolvedValueOnce(false);
    await expect(service.export(99)).rejects.toBeInstanceOf(NotFoundException);
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
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { ticketCount: 1 } }),
    );
  });
});
