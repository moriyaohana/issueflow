import { FindOptionsWhere, IsNull } from 'typeorm';

export function liveOnly<T>(
  where: FindOptionsWhere<T> = {},
): FindOptionsWhere<T> {
  return { ...where, deletedAt: IsNull() } as FindOptionsWhere<T>;
}
