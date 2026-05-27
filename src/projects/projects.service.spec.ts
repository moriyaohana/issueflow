import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { Project } from './entities/project.entity';
import { UsersService } from '../users/users.service';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let repo: any;
  let users: any;

  beforeEach(async () => {
    repo = {
      create: jest.fn().mockImplementation((d) => ({ id: 1, ...d })),
      save: jest.fn().mockImplementation((p) => Promise.resolve({ id: 1, ...p })),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      softRemove: jest.fn().mockResolvedValue(undefined),
      restore: jest.fn().mockResolvedValue(undefined),
      count: jest.fn(),
    };
    users = {
      existsAndActive: jest.fn(),
      findOneIncludingDeleted: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: getRepositoryToken(Project), useValue: repo },
        { provide: UsersService, useValue: users },
      ],
    }).compile();
    service = moduleRef.get(ProjectsService);
  });

  it('400 when owner is soft-deleted', async () => {
    users.existsAndActive.mockResolvedValueOnce(false);
    users.findOneIncludingDeleted.mockResolvedValueOnce({
      id: 1,
      deletedAt: new Date(),
    });
    await expect(
      service.create({ name: 'p', description: 'd', ownerId: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404 when owner does not exist', async () => {
    users.existsAndActive.mockResolvedValueOnce(false);
    users.findOneIncludingDeleted.mockRejectedValueOnce(new NotFoundException());
    await expect(
      service.create({ name: 'p', description: 'd', ownerId: 999 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('persists when owner is active', async () => {
    users.existsAndActive.mockResolvedValueOnce(true);
    const out = await service.create({ name: 'p', description: 'd', ownerId: 1 });
    expect(repo.save).toHaveBeenCalled();
    expect(out).toMatchObject({ name: 'p', description: 'd', ownerId: 1 });
  });

  it('softDelete calls cascade handler when registered', async () => {
    const project = { id: 7, deletedAt: null };
    repo.findOne.mockResolvedValueOnce(project);
    const handler = {
      cascadeSoftDeleteForProject: jest.fn().mockResolvedValue(undefined),
      cascadeRestoreForProject: jest.fn(),
    };
    service.setCascadeHandler(handler);
    await service.softDelete(7);
    expect(repo.softRemove).toHaveBeenCalledWith(project);
    expect(handler.cascadeSoftDeleteForProject).toHaveBeenCalledWith(7);
  });

  it('restore re-enables visibility and triggers cascade restore', async () => {
    const deletedProject = { id: 7, deletedAt: new Date() };
    repo.findOne
      .mockResolvedValueOnce(deletedProject)
      .mockResolvedValueOnce({ id: 7, deletedAt: null });
    const handler = {
      cascadeSoftDeleteForProject: jest.fn(),
      cascadeRestoreForProject: jest.fn().mockResolvedValue(undefined),
    };
    service.setCascadeHandler(handler);
    const restored = await service.restore(7);
    expect(repo.restore).toHaveBeenCalledWith(7);
    expect(handler.cascadeRestoreForProject).toHaveBeenCalledWith(7);
    expect(restored).toBeTruthy();
  });

  it('findAllDeleted filters by non-null deletedAt with withDeleted', async () => {
    repo.find.mockResolvedValueOnce([]);
    await service.findAllDeleted();
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({ withDeleted: true }),
    );
  });
});
