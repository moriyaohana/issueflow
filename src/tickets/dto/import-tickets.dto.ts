import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

// @Type coerces the multipart form value (always a string) before @IsInt.
export class ImportTicketsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  projectId: number;
}
