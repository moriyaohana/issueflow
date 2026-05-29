import { PreconditionFailedException } from '@nestjs/common';

/**
 * Optimistic-concurrency guard. Throws a 412 with the row's actual version so
 * the caller can retry against the fresh value. Centralised so the error
 * envelope (`message` + `currentVersion`) stays identical across every
 * versioned write path (tickets, comments, …).
 */
export function assertVersionMatches(
  entity: { version: number },
  expected: number,
  entityName: string,
): void {
  if (entity.version !== expected) {
    throw new PreconditionFailedException({
      message: `${entityName} version mismatch`,
      currentVersion: entity.version,
    });
  }
}
