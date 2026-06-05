import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ClipsService } from './clips.service';
import { BearerUserGuard } from '../auth/bearer-user.guard';
import { CurrentUser, ResolvedUser } from '../auth/current-user.decorator';

@Controller()
@UseGuards(BearerUserGuard)
export class ClipsController {
  constructor(private readonly clipsService: ClipsService) {}

  @Get('projects/:projectId/clips')
  async findByProject(@CurrentUser() user: ResolvedUser, @Param('projectId') projectId: string) {
    return this.clipsService.findByProject(projectId, user.id);
  }

  @Post('projects/:projectId/clips/manual')
  async createManualClip(
    @CurrentUser() user: ResolvedUser,
    @Param('projectId') projectId: string,
    @Body() body: { startTime: number; endTime: number },
  ) {
    return this.clipsService.createManualClip(projectId, body.startTime, body.endTime, user.id);
  }

  @Post('projects/:projectId/clips/:clipId/select')
  async selectClip(
    @CurrentUser() user: ResolvedUser,
    @Param('projectId') projectId: string,
    @Param('clipId') clipId: string,
    @Body() body: { selected: boolean },
  ) {
    return this.clipsService.selectClip(projectId, clipId, body.selected, user.id);
  }

  @Get('projects/:projectId/clips/:clipId/subtitles')
  async getSubtitles(
    @CurrentUser() user: ResolvedUser,
    @Param('projectId') projectId: string,
    @Param('clipId') clipId: string,
  ) {
    return this.clipsService.getSubtitles(projectId, clipId, user.id);
  }
}
