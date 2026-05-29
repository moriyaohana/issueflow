import { FindOptionsWhere, IsNull } from 'typeorm';

/** Wraps a FindOptionsWhere with `deletedAt: IsNull()` so soft-deleted rows
 * are filtered out. Co-located here so the predicate lives in one place. */
export function liveOnly<T>(
  where: FindOptionsWhere<T> = {},
): FindOptionsWhere<T> {
  return { ...where, deletedAt: IsNull() } as FindOptionsWhere<T>;
}
