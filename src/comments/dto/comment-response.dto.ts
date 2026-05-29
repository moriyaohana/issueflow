export interface MentionedUser {
  id: number;
  username: string;
  fullName: string;
}

export interface CommentLike {
  id: number;
  ticketId: number;
  authorId: number;
  content: string;
}

export class CommentResponseDto {
  id: number;
  ticketId: number;
  authorId: number;
  content: string;
  mentionedUsers: MentionedUser[];

  static fromEntity(
    source: CommentLike,
    mentionedUsers: MentionedUser[] = [],
  ): CommentResponseDto {
    const dto = new CommentResponseDto();
    dto.id = source.id;
    dto.ticketId = source.ticketId;
    dto.authorId = source.authorId;
    dto.content = source.content;
    dto.mentionedUsers = mentionedUsers.map((u) => ({
      id: u.id,
      username: u.username,
      fullName: u.fullName,
    }));
    return dto;
  }
}
