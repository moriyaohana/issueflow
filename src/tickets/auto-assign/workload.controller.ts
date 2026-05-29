import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { AutoAssignService, WorkloadEntry } from './auto-assign.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';

// Workload is visible to any logged-in non-public role: devs may legitimately
// want to see their own and teammates' load before grabbing a ticket, and
// admins are obviously included. Project-membership is not modelled in this
// codebase, so this is the cleanest "any logged-in employee" formulation.
@Controller('projects/:projectId/workload')
@Roles(UserRole.ADMIN, UserRole.DEVELOPER)
export class WorkloadController {
  constructor(private readonly auto: AutoAssignService) {}

  @Get()
  list(@Param('projectId', ParseIntPipe) projectId: number): Promise<WorkloadEntry[]> {
    return this.auto.getProjectWorkload(projectId);
  }
}
