import { MentionParser } from './mention-parser';
import { UsersService } from '../../users/users.service';

describe('MentionParser', () => {
  it('extracts unique lowercased usernames', () => {
    const parser = new MentionParser({} as UsersService);
    const usernames = parser.extractUsernames('Hi @Alice, @bob and @ALICE!');
    expect(usernames.sort()).toEqual(['alice', 'bob']);
  });

  it('returns empty array when no mentions present', () => {
    const parser = new MentionParser({} as UsersService);
    expect(parser.extractUsernames('no handles here')).toEqual([]);
  });

  it('resolves to active users only', async () => {
    const users = {
      findByUsernamesCaseInsensitive: jest
        .fn()
        .mockResolvedValue([{ id: 1, username: 'alice', fullName: 'Alice A' }]),
    } as unknown as UsersService;
    const parser = new MentionParser(users);
    const result = await parser.resolve('hi @alice @ghost');
    expect(users.findByUsernamesCaseInsensitive).toHaveBeenCalledWith(['alice', 'ghost']);
    expect(result.length).toBe(1);
    expect(result[0].username).toBe('alice');
  });
});
