import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

/**
 * Multipart form fields for `POST /tickets/import`.
 *
 * Multer parses non-file form parts as strings, so `projectId` arrives as
 * `'42'` rather than `42`. `@Type(() => Number)` (class-transformer) coerces
 * it before class-validator runs, after which `@IsInt` / `@Min(1)` give us
 * the same guardrails the JSON endpoints enjoy.
 *
 * Going through a typed DTO (instead of `@Body('projectId', ParseIntPipe)`)
 * means the global `ValidationPipe({ forbidNonWhitelisted: true })` rejects
 * any junk form fields a client might smuggle alongside the file.
 */
export class ImportTicketsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  projectId: number;
}
