import { Controller, Get, Param, NotFoundException, UseGuards } from '@nestjs/common';
import { ExportsService, Export, UserExport } from './exports.service';
import { BearerUserGuard } from '../auth/bearer-user.guard';
import { CurrentUser, ResolvedUser } from '../auth/current-user.decorator';
@Controller()
@UseGuards(BearerUserGuard)
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}
  @Get('projects/:projectId/exports')
  async findByProject(@CurrentUser() user: ResolvedUser, @Param('projectId') projectId: string): Promise<Export[]> {
    return this.exportsService.findByProject(projectId, user.id);
  }
  @Get('exports')
  async findCompletedByUser(@CurrentUser() user: ResolvedUser): Promise<UserExport[]> {
    return this.exportsService.findCompletedByUser(user.id);
  }
  @Get('exports/:id')
  async findOne(@CurrentUser() user: ResolvedUser, @Param('id') id: string): Promise<Export> {
    const exportRecord = await this.exportsService.findOne(id, user.id);
    if (!exportRecord) {
      throw new NotFoundException(`Export with id "${id}" not found`);
    }
    return exportRecord;
  }
}
