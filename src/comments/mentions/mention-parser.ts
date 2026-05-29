import { Injectable } from '@nestjs/common';
import { UsersService } from '../../users/users.service';
import { User } from '../../users/entities/user.entity';

const MENTION_REGEX = /@([a-zA-Z0-9_]+)/g;

/**
 * Wire-safe projection of a `User` returned to comment callers. `email` and
 * `passwordHash` are intentionally absent — narrowing the return type at the
 * source makes it impossible for downstream code (mention feed, comment
 * payload) to leak either field.
 */
export type ResolvedMention = Pick<User, 'id' | 'username' | 'fullName'>;

@Injectable()
export class MentionParser {
  constructor(private readonly users: UsersService) {}

  extractUsernames(content: string): string[] {
    if (!content) return [];
    const seen = new Set<string>();
    for (const match of content.matchAll(MENTION_REGEX)) {
      seen.add(match[1].toLowerCase());
    }
    return [...seen];
  }

  /**
   * Resolves mention handles to active users. Unknown or soft-deleted handles
   * are silently dropped — they should not block comment creation.
   *
   * Returns only the wire-safe subset of `User` so callers physically cannot
   * leak `email` / `passwordHash`. Combined with the `select: false` on
   * `passwordHash` (Agent 3), the field is also absent from the row.
   */
  async resolve(content: string): Promise<ResolvedMention[]> {
    const usernames = this.extractUsernames(content);
    if (usernames.length === 0) return [];
    const users = await this.users.findByUsernamesCaseInsensitive(usernames);
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      fullName: u.fullName,
    }));
  }
}
