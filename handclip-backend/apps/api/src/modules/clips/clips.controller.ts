import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { CurrentUser } from '../../decorators/current-user.decorator';

@Controller()
export class ClipsController {
  constructor(private readonly clipsService: ClipsService) {}

  @Get('projects/:projectId/clips')
  async findByProject(
    @Param('projectId') projectId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.clipsService.findByProject(projectId, user.id);
  }

  @Post('projects/:projectId/clips/manual')
  async createManualClip(
    @Param('projectId') projectId: string,
    @Body() body: { startTime: number; endTime: number },
    @CurrentUser() user: { id: string },
  ) {
    return this.clipsService.createManualClip(projectId, user.id, body.startTime, body.endTime);
  }

  @Post('projects/:projectId/clips/:clipId/select')
  async selectClip(
    @Param('projectId') projectId: string,
    @Param('clipId') clipId: string,
    @Body() body: { selected: boolean },
    @CurrentUser() user: { id: string },
  ) {
    return this.clipsService.selectClip(projectId, user.id, clipId, body.selected);
  }
}
