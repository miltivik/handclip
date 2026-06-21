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
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { CHUNK_UPLOAD_SIZE_BYTES } from '@handclip/shared';
import {
  InitUploadDtoSchema,
  InitUploadDto,
  CompleteUploadDtoSchema,
  CompleteUploadDto,
} from '@handclip/shared';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('init')
  @Throttle({ default: { limit: 10, ttl: seconds(60) } })
  async initUpload(
    @Body(new ZodValidationPipe(InitUploadDtoSchema)) body: InitUploadDto,
    @CurrentUser() user: { id: string },
  ) {
    const uploadId = await this.uploadsService.initUpload(
      user.id,
      body.fileName,
      body.fileSize,
      body.mimeType,
    );
    return { uploadId };
  }

  @Post(':uploadId/chunk')
  @Throttle({ default: { limit: 1000, ttl: seconds(60) } })
  @UseInterceptors(FileInterceptor('chunk', {
    // ponytail: 5MB chunk + 1KB overhead for multipart framing
    limits: { fileSize: CHUNK_UPLOAD_SIZE_BYTES + 1024 },
  }))
  async uploadChunk(
    @Param('uploadId') uploadId: string,
    @CurrentUser() user: { id: string },
    @UploadedFile() file: Express.Multer.File,
    @Body('chunkIndex') chunkIndex: string,
  ) {
    const index = parseInt(chunkIndex, 10);
    if (isNaN(index)) {
      throw new BadRequestException('chunkIndex must be a number');
    }
    return this.uploadsService.uploadChunk(uploadId, index, file.buffer, user.id);
  }

  @Post(':uploadId/complete')
  @Throttle({ default: { limit: 30, ttl: seconds(60) } })
  async completeUpload(
    @Param('uploadId') uploadId: string,
    @CurrentUser() user: { id: string },
    @CurrentToken() token: string,
    @Body(new ZodValidationPipe(CompleteUploadDtoSchema)) body: CompleteUploadDto,
  ) {
    return this.uploadsService.completeUpload(uploadId, user.id, token, body.checksum);
  }
}
