import {
  Controller,
  Post,
  Param,
  Body,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadsService } from './uploads.service';
import { BearerUserGuard } from '../auth/bearer-user.guard';
import { CurrentUser, ResolvedUser } from '../auth/current-user.decorator';

@Controller('uploads')
@UseGuards(BearerUserGuard)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('init')
  async initUpload(
    @CurrentUser() user: ResolvedUser,
    @Body() body: { fileName: string; fileSize: number; mimeType: string },
  ) {
    const uploadId = await this.uploadsService.initUpload(
      user.id,
      body.fileName,
      body.fileSize,
      body.mimeType,
    );
    return uploadId;
  }

  @Post(':uploadId/chunk')
  @UseInterceptors(FileInterceptor('chunk'))
  async uploadChunk(
    @CurrentUser() user: ResolvedUser,
    @Param('uploadId') uploadId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('chunkIndex') chunkIndex: string,
  ) {
    const index = parseInt(chunkIndex, 10);
    if (isNaN(index)) {
      throw new BadRequestException('chunkIndex must be a number');
    }
    return this.uploadsService.uploadChunk(uploadId, user.id, index, file.buffer);
  }

  @Post(':uploadId/complete')
  async completeUpload(
    @CurrentUser() user: ResolvedUser,
    @Param('uploadId') uploadId: string,
    @Body() body: { checksum?: string },
  ) {
    return this.uploadsService.completeUpload(uploadId, user.id, body.checksum);
  }
}
