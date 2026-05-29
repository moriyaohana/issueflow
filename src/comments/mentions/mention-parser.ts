import { Injectable } from '@nestjs/common';
import { UsersService } from '../../users/users.service';
import { User } from '../../users/entities/user.entity';

// Left-side `(?:^|[^\p{L}\p{N}_])` blocks email-style tokens like `foo@bar`;
// capture group 1 is the username (read `match[1]`, not `match[0]`).
const MENTION_REGEX = /(?:^|[^\p{L}\p{N}_])@([\p{L}\p{N}_\-]+)/gu;

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

  // Unknown / soft-deleted handles are silently dropped — they must not
  // block comment creation.
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
