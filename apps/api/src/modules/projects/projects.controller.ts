import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JobsService } from '../jobs/jobs.service';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly jobsService: JobsService,
  ) {}

  @Post()
  async create(@Body() body: { name: string; description?: string }) {
    return this.projectsService.create(body.name, body.description);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('video', {
      limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
      fileFilter: (req, file, cb) => {
        const allowed = [
          'video/mp4',
          'video/quicktime',
          'video/webm',
          'video/x-m4v',
          'video/x-matroska',
        ];
        if (allowed.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new Error('Formato no soportado. Usa MP4, MOV, WEBM, M4V o MKV.'),
            false,
          );
        }
      },
    }),
  )
  async uploadVideo(
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name: string,
  ) {
    return this.projectsService.uploadAndCreateProject(file, name);
  }

  @Get(':id/video-url')
  async getVideoUrl(@Param('id') id: string) {
    const signedUrl = await this.projectsService.getSignedVideoUrl(id);
    return { videoUrl: signedUrl };
  }

  @Get()
  async findAll() {
    return this.projectsService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.projectsService.findOne(id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.projectsService.remove(id);
    return { success: true };
  }

  @Post(':id/export')
  async exportClip(
    @Param('id') id: string,
    @Body() body: {
      clipId: string;
      trimStart: number;
      trimEnd: number;
      subtitles: any[];
      musicUrl?: string;
      musicVolume?: number;
      musicFadeIn?: number;
      musicFadeOut?: number;
      preset: 'tiktok' | 'reels' | 'shorts' | 'draft' | 'hq';
    },
  ) {
    const user = await this.projectsService.getCurrentUser();
    const videoUrl = await this.projectsService.getVideoUrl(id);

    const result = await this.jobsService.enqueueRender({
      projectId: id,
      userId: user?.id || 'anonymous',
      videoUrl,
      trimStart: body.trimStart,
      trimEnd: body.trimEnd,
      subtitles: body.subtitles,
      musicUrl: body.musicUrl,
      musicVolume: body.musicVolume,
      musicFadeIn: body.musicFadeIn,
      musicFadeOut: body.musicFadeOut,
      preset: body.preset || 'tiktok',
    });

    return result;
  }
}
