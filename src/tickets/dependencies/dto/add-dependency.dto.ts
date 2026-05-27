import { IsInt } from 'class-validator';

export class AddDependencyDto {
  @IsInt()
  blockedBy: number;
}
