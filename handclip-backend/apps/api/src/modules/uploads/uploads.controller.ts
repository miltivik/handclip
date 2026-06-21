import {
  Controller,
  Post,
  Param,
  Body,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../decorators/current-user.decorator';
import { CurrentToken } from '../../decorators/current-token.decorator';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  // init: low — each init creates a 30-min upload session with reserved disk
  @Post('init')
  @Throttle({ default: { limit: 10, ttl: seconds(60) } })
  async initUpload(
    @Body() body: { fileName: string; fileSize: number; mimeType: string },
    @CurrentUser() user: { id: string },
  ) {
    const uploadId = await this.uploadsService.initUpload(
      user.id,
      body.fileName,
      body.fileSize,
      body.mimeType,
    );
    return uploadId;
  }

  // chunk: a 500MB upload = 100 chunks. Allow 1000/min per IP so retries
  // don't blow the limit. Still bounded.
  @Post(':uploadId/chunk')
  @Throttle({ default: { limit: 1000, ttl: seconds(60) } })
  @UseInterceptors(FileInterceptor('chunk'))
  async uploadChunk(
    @Param('uploadId') uploadId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('chunkIndex') chunkIndex: string,
  ) {
    const index = parseInt(chunkIndex, 10);
    if (isNaN(index)) {
      throw new BadRequestException('chunkIndex must be a number');
    }
    return this.uploadsService.uploadChunk(uploadId, index, file.buffer);
  }

  // complete: low — one per upload session
  @Post(':uploadId/complete')
  @Throttle({ default: { limit: 30, ttl: seconds(60) } })
  async completeUpload(
    @Param('uploadId') uploadId: string,
    @CurrentUser() user: { id: string },
    @CurrentToken() token: string,
    @Body() body: { checksum?: string },
  ) {
    return this.uploadsService.completeUpload(uploadId, user.id, token, body.checksum);
  }
}
