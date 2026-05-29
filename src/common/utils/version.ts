import { PreconditionFailedException } from '@nestjs/common';
import { versionMismatch } from '../errors/messages';

export function assertVersionMatches(
  entity: { version: number },
  expected: number,
  entityName: string,
): void {
  if (entity.version !== expected) {
    throw new PreconditionFailedException({
      message: versionMismatch(entityName),
      currentVersion: entity.version,
    });
  }
}
