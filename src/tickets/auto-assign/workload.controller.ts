import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { AutoAssignService, WorkloadEntry } from './auto-assign.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';

@Controller('projects/:projectId/workload')
@Roles(UserRole.ADMIN, UserRole.DEVELOPER)
export class WorkloadController {
  constructor(private readonly auto: AutoAssignService) {}

  @Get()
  list(@Param('projectId', ParseIntPipe) projectId: number): Promise<WorkloadEntry[]> {
    return this.auto.getProjectWorkload(projectId);
  }
}
