import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { ClipsService } from './clips.service';

@Controller()
export class ClipsController {
  constructor(private readonly clipsService: ClipsService) {}

  @Get('projects/:projectId/clips')
  async findByProject(@Param('projectId') projectId: string) {
    return this.clipsService.findByProject(projectId);
  }

  @Post('projects/:projectId/clips/:clipId/select')
  async selectClip(
    @Param('projectId') projectId: string,
    @Param('clipId') clipId: string,
    @Body() body: { selected: boolean },
  ) {
    return this.clipsService.selectClip(projectId, clipId, body.selected);
  }
}
