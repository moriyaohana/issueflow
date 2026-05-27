import { UserRole } from '../../common/enums/user-role.enum';
import { User } from '../entities/user.entity';

export class UserResponseDto {
  id: number;
  username: string;
  email: string;
  fullName: string;
  role: UserRole;

  static fromEntity(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.username = user.username;
    dto.email = user.email;
    dto.fullName = user.fullName;
    dto.role = user.role;
    return dto;
  }
}
