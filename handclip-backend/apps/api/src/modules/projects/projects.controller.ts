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
import { diskStorage } from 'multer';
import * as os from 'os';
import { unlinkSync } from 'fs';
import { CurrentUser } from '../../decorators/current-user.decorator';
import { CurrentToken } from '../../decorators/current-token.decorator';
import { JobsService } from '../jobs/jobs.service';
import { ProjectsService } from './projects.service';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { AnalyzeProjectDtoSchema, AnalyzeProjectDto } from '@handclip/shared';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly jobsService: JobsService,
  ) {}

  @Post()
  async create(
    @Body() body: {
      name: string;
      description?: string;
      sourceVideoUrl?: string;
      duration?: number;
      width?: number;
      height?: number;
    },
    @CurrentUser() user: { id: string },
  ) {
    return this.projectsService.create(user.id, body);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('video', {
      storage: diskStorage({
        destination: os.tmpdir(),
        filename: (req, file, cb) =>
          cb(null, `${Date.now()}-${file.originalname}`),
      }),
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
    @CurrentUser() user: { id: string },
  ) {
    const result = await this.projectsService.uploadAndCreateProject(file, name, user.id);
    // Clean up temp file written by multer disk storage
    if (file.path) {
      try {
        unlinkSync(file.path);
      } catch {
        // Best-effort cleanup; ignore errors
      }
    }
    return result;
  }

  @Get(':id/video-url')
  async getVideoUrl(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    const signedUrl = await this.projectsService.getSignedVideoUrl(id, user.id);
    return { videoUrl: signedUrl };
  }

  @Get()
  async findAll(@CurrentUser() user: { id: string }) {
    return this.projectsService.findAll(user.id);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.projectsService.findOne(id, user.id);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    await this.projectsService.remove(id, user.id);
    return { success: true };
  }
  @Post(':id/analyze')
  async analyze(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AnalyzeProjectDtoSchema)) body: AnalyzeProjectDto,
    @CurrentUser() user: { id: string },
    @CurrentToken() token: string,
  ) {
    const result = await this.jobsService.enqueueAnalysis(token, id, body.videoUrl);
    return { jobId: result.jobId };
  }
  @Post(':id/export')
  async exportClip(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @CurrentToken() token: string,
    @Body() body: {
      clipId: string;
      trimStart: number;
      trimEnd: number;
      subtitles: unknown[];
      musicUrl?: string;
      musicVolume?: number;
      musicFadeIn?: number;
      musicFadeOut?: number;
      preset: 'tiktok' | 'reels' | 'shorts' | 'draft' | 'hq';
    },
  ) {
    const videoUrl = await this.projectsService.getVideoUrl(id, user.id);

    const result = await this.jobsService.enqueueRender(token, {
      projectId: id,
      userId: user.id,
      videoUrl,
      trimStart: body.trimStart,
      trimEnd: body.trimEnd,
      subtitles: body.subtitles,
      musicUrl: body.musicUrl,
      musicVolume: body.musicVolume,
      musicFadeIn: body.musicFadeIn,
      musicFadeOut: body.musicFadeOut,
      preset: body.preset || 'tiktok',
      clipId: body.clipId,
    });

    return result;
  }

  @Get(':id/export/:jobId')
  async getExportJobStatus(
    @Param('id') id: string,
    @Param('jobId') jobId: string,
    @CurrentUser() user: { id: string },
    @CurrentToken() token: string,
  ) {
    return this.jobsService.getJob(jobId, token);
  }
}
