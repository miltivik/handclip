import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { ExportsService, Export } from './exports.service';

@Controller()
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Get('projects/:projectId/exports')
  async findByProject(@Param('projectId') projectId: string): Promise<Export[]> {
    return this.exportsService.findByProject(projectId);
  }

  @Get('exports/:id')
  async findOne(@Param('id') id: string): Promise<Export> {
    const exportRecord = await this.exportsService.findOne(id);
    if (!exportRecord) {
      throw new NotFoundException(`Export with id "${id}" not found`);
    }
    return exportRecord;
  }
}
