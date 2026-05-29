import { Project } from '../entities/project.entity';

/**
 * Wire shape for project responses. The entity carries internal columns
 * (`createdAt`, `updatedAt`, `deletedAt`) that aren't part of the documented
 * API contract; we project to this DTO at the controller boundary so those
 * columns can't leak even if a future read path adds withDeleted/raw queries.
 */
export class ProjectResponseDto {
  id: number;
  name: string;
  description: string;
  ownerId: number;

  static fromEntity(project: Project): ProjectResponseDto {
    const dto = new ProjectResponseDto();
    dto.id = project.id;
    dto.name = project.name;
    dto.description = project.description;
    dto.ownerId = project.ownerId;
    return dto;
  }
}
