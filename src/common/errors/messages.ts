import { EntityType } from '../enums/entity-type.enum';

/**
 * Canonical "<entity> <id> not found" message used by every NotFoundException
 * across the service. Centralised so the wire copy stays identical and a
 * future tweak (e.g. localisation) only edits one site.
 */
export function entityNotFound(
  entityType: EntityType,
  id: number | string,
): string {
  return `${entityType} ${id} not found`;
}

/** 403 message when a writer targets a DONE ticket. */
export const TICKET_IS_DONE = 'Ticket is DONE and cannot be modified';

/**
 * Suffix appended to the entity name in `${entity} version mismatch`. The
 * full message is produced by {@link assertVersionMatches}; this constant is
 * exported so callers building the message directly (e.g. the
 * OptimisticLockVersionMismatchError translation paths in tickets.service)
 * stay aligned with the shared helper's wording.
 */
export const VERSION_MISMATCH_SUFFIX = 'version mismatch';

export function versionMismatch(entityName: string): string {
  return `${entityName} ${VERSION_MISMATCH_SUFFIX}`;
}
