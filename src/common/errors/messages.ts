import { EntityType } from '../enums/entity-type.enum';

export function entityNotFound(
  entityType: EntityType,
  id: number | string,
): string {
  return `${entityType} ${id} not found`;
}

export const TICKET_IS_DONE = 'Ticket is DONE and cannot be modified';

export const VERSION_MISMATCH_SUFFIX = 'version mismatch';

export function versionMismatch(entityName: string): string {
  return `${entityName} ${VERSION_MISMATCH_SUFFIX}`;
}
