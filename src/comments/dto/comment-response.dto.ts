/**
 * Subset of `User` we are willing to expose inside a comment's
 * `mentionedUsers` array. `email` and `passwordHash` are intentionally
 * absent — leaking either via a mention payload would be a regression.
 */
export interface MentionedUser {
  id: number;
  username: string;
  fullName: string;
}

/**
 * Minimal shape needed to build a {@link CommentResponseDto}. Accepts both
 * the raw entity and the service-internal `CommentResponse` (which carries
 * `version` out-of-band for ETag) without forcing either side to know about
 * the other's shape.
 */
export interface CommentLike {
  id: number;
  ticketId: number;
  authorId: number;
  content: string;
}

/**
 * Wire shape for comment responses. Matches the README documented set of
 * fields exactly so internal columns (`version`, `deletedByCascade`,
 * `deletedAt`, `createdAt`, `updatedAt`) cannot leak. `version` is conveyed
 * out-of-band via the `ETag` header for the write endpoints.
 */
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
