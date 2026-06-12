import {
  Controller,
  Post,
  Param,
  Body,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../decorators/current-user.decorator';
import { CurrentToken } from '../../decorators/current-token.decorator';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('init')
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

  @Post(':uploadId/chunk')
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
  @Post(':uploadId/complete')
  async completeUpload(
    @Param('uploadId') uploadId: string,
    @CurrentUser() user: { id: string },
    @CurrentToken() token: string,
    @Body() body: { checksum?: string },
  ) {
    return this.uploadsService.completeUpload(uploadId, user.id, token, body.checksum);
  }
}
