import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { AutoAssignService, WorkloadEntry } from './auto-assign.service';

@Controller('projects/:projectId/workload')
export class WorkloadController {
  constructor(private readonly auto: AutoAssignService) {}

  @Get()
  list(@Param('projectId', ParseIntPipe) projectId: number): Promise<WorkloadEntry[]> {
    return this.auto.getProjectWorkload(projectId);
  }
}
