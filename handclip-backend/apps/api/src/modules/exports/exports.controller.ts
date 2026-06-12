import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { ExportsService, Export } from './exports.service';
import { CurrentToken } from '../../decorators/current-token.decorator';

@Controller()
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}
  @Get('projects/:projectId/exports')
  async findByProject(
    @Param('projectId') projectId: string,
    @CurrentToken() token: string,
  ): Promise<Export[]> {
    return this.exportsService.findByProject(projectId, token);
  }

  @Get('exports/:id/status')
  async getStatus(
    @Param('id') id: string,
    @CurrentToken() token: string,
  ): Promise<ExportStatus> {
    const status = await this.exportsService.getStatus(id, token);
    if (!status) {
      throw new NotFoundException(`Export with id "${id}" not found`);
    }
    return status;
  }

  @Get('exports/:id')
  async findOne(
    @Param('id') id: string,
    @CurrentToken() token: string,
  ): Promise<Export> {
    const exportRecord = await this.exportsService.findOne(id, token);
    if (!exportRecord) {
      throw new NotFoundException(`Export with id "${id}" not found`);
    }
    return exportRecord;
  }
}

export interface ExportStatus {
  status: string;
  progress: number;
  outputUrl: string | null;
  error?: string;
}
