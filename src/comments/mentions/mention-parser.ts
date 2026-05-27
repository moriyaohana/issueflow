import { Injectable } from '@nestjs/common';
import { UsersService } from '../../users/users.service';
import { User } from '../../users/entities/user.entity';

const MENTION_REGEX = /@([a-zA-Z0-9_]+)/g;

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
   */
  async resolve(content: string): Promise<User[]> {
    const usernames = this.extractUsernames(content);
    if (usernames.length === 0) return [];
    return this.users.findByUsernamesCaseInsensitive(usernames);
  }
}
