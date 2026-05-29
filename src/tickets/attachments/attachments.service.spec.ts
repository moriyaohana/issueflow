import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { AttachmentsService } from './attachments.service';
import { Attachment } from './entities/attachment.entity';
import { TicketsService } from '../tickets.service';
import { AuditLogService } from '../../audit-log/audit-log.service';

describe('AttachmentsService', () => {
  let service: AttachmentsService;
  let repo: any;
  let tickets: any;

  beforeEach(async () => {
    repo = {
      create: jest.fn().mockImplementation((d) => ({ id: 1, ...d })),
      save: jest.fn().mockImplementation((a) => Promise.resolve(a)),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue(undefined),
      softDelete: jest.fn().mockResolvedValue(undefined),
    };
    tickets = {
      assertActive: jest.fn().mockResolvedValue(undefined),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AttachmentsService,
        { provide: getRepositoryToken(Attachment), useValue: repo },
        { provide: TicketsService, useValue: tickets },
        {
          provide: AuditLogService,
          useValue: { record: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();
    service = moduleRef.get(AttachmentsService);
  });

  it('rejects when ticket is soft-deleted', async () => {
    tickets.assertActive.mockRejectedValueOnce(
      new NotFoundException('Ticket 99 not found'),
    );
    await expect(
      service.upload({
        ticketId: 99,
        file: {
          originalname: 'a.png',
          mimetype: 'image/png',
          size: 4,
          buffer: Buffer.from([0, 1, 2, 3]),
        },
        actorUserId: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('saves a valid PNG and returns metadata without raw bytes', async () => {
    const result = await service.upload({
      ticketId: 1,
      file: {
        originalname: 'a.png',
        mimetype: 'image/png',
        size: 4,
        buffer: Buffer.from([0, 1, 2, 3]),
      },
      actorUserId: 7,
    });
    expect(result).toEqual(
      expect.objectContaining({
        ticketId: 1,
        filename: 'a.png',
        contentType: 'image/png',
      }),
    );
    expect(result).not.toHaveProperty('data');
  });

  it('rejects delete when attachment belongs to a different ticket', async () => {
    repo.findOne.mockResolvedValueOnce({ id: 9, ticketId: 1 });
    await expect(service.delete(2, 9)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
