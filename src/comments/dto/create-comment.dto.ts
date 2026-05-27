import { IsInt, IsNotEmpty } from 'class-validator';

export class CreateCommentDto {
  @IsInt()
  authorId: number;

  @IsNotEmpty()
  content: string;
}
