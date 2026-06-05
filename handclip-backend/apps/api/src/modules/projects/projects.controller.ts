import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseInterceptors,
  UseGuards,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProjectsService } from './projects.service';
import { JobsService } from '../jobs/jobs.service';
import { BearerUserGuard } from '../auth/bearer-user.guard';
import { CurrentUser, ResolvedUser } from '../auth/current-user.decorator';
const ALLOWED_SPEEDS = [0.5, 1, 2] as const;
type ExportSpeed = (typeof ALLOWED_SPEEDS)[number];

function parseExportSpeed(value: unknown): ExportSpeed {
  if (value === undefined || value === null) return 1;
  if (typeof value !== 'number' || !ALLOWED_SPEEDS.includes(value as ExportSpeed)) {
    throw new BadRequestException('speed must be one of 0.5, 1, 2');
  }
  return value as ExportSpeed;
}

const ALLOWED_POSITIONS = ['top', 'center', 'bottom'] as const;
type TextOverlayPosition = (typeof ALLOWED_POSITIONS)[number];
interface TextOverlay { text: string; position: TextOverlayPosition }

function parseTextOverlay(value: unknown): TextOverlay | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('textOverlay must be an object');
  }
  const obj = value as unknown as Record<string, unknown>;
  if (typeof obj['text'] !== 'string') {
    throw new BadRequestException('textOverlay.text must be a string');
  }
  const trimmed = (obj['text'] as string).trim();
  if (!trimmed) return null;
  if (trimmed.length > 120) {
    throw new BadRequestException('textOverlay.text must be 120 characters or less');
  }
  if (!ALLOWED_POSITIONS.includes(obj['position'] as TextOverlayPosition)) {
    throw new BadRequestException('textOverlay.position must be one of top, center, bottom');
  }
  return { text: trimmed, position: obj['position'] as TextOverlayPosition };
}

@Controller('projects')
@UseGuards(BearerUserGuard)
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly jobsService: JobsService,
  ) {}

  @Post()
  async create(@CurrentUser() user: ResolvedUser, @Body() body: {
    name: string;
    description?: string;
    sourceVideoUrl?: string;
    duration?: number;
    width?: number;
    height?: number;
  }) {
    return this.projectsService.create(user.id, body);
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
    @CurrentUser() user: ResolvedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name: string,
  ) {
    return this.projectsService.uploadAndCreateProject(file, name, user.id);
  }

  @Get(':id/video-url')
  async getVideoUrl(@CurrentUser() user: ResolvedUser, @Param('id') id: string) {
    const signedUrl = await this.projectsService.getSignedVideoUrl(id, user.id);
    return { videoUrl: signedUrl };
  }

  @Get()
  async findAll(@CurrentUser() user: ResolvedUser) {
    return this.projectsService.findAll(user.id);
  }

  @Get(':id')
  async findOne(@CurrentUser() user: ResolvedUser, @Param('id') id: string) {
    return this.projectsService.findOne(id, user.id);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: ResolvedUser, @Param('id') id: string) {
    return this.projectsService.remove(id, user.id);
  }

  @Post(':id/analyze')
  async analyze(
    @CurrentUser() user: ResolvedUser,
    @Param('id') id: string,
  ) {
    const videoUrl = await this.projectsService.getSignedVideoUrl(id, user.id);
    const result = await this.jobsService.enqueueAnalysis(id, user.id, videoUrl);
    return { jobId: result.jobId };
  }

  @Post(':id/export')
  async exportClip(
    @CurrentUser() user: ResolvedUser,
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
      speed?: number;
      textOverlay?: { text: string; position: 'top' | 'center' | 'bottom' };
    },
  ) {
    const videoUrl = await this.projectsService.getVideoUrl(id, user.id);
    const speed = parseExportSpeed(body.speed);
    // Defensively validate textOverlay in worker as well (see jobs.service.ts)
    const textOverlay = parseTextOverlay(body.textOverlay);

    const result = await this.jobsService.enqueueRender({
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
      speed,
      textOverlay,
    });

    return result;
  }

  @Get(':id/export/:jobId')
  async getExportJobStatus(
    @CurrentUser() user: ResolvedUser,
    @Param('id') id: string,
    @Param('jobId') jobId: string,
  ) {
    return this.jobsService.getJobForUser(jobId, user.id);
  }
}
