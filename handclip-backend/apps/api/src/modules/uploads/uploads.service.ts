import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'crypto';
import { createWriteStream, createReadStream, existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';

export const ALLOWED_VIDEO_MIMETYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
  'video/x-matroska',
];

export const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024; // 500MB
export const MAX_AUDIO_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

export const ALLOWED_AUDIO_MIMETYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/ogg',
  'audio/webm',
];

interface UploadMetadata {
  userId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  extension: string;
  totalChunks: number;
  chunks: Map<number, string>; // chunkIndex -> temp file path
  tempDir: string;
}

@Injectable()
export class UploadsService {
  private uploads = new Map<string, UploadMetadata>();

  constructor(private readonly supabaseService: SupabaseService) {}

  async uploadAudio(
    file: Express.Multer.File,
    userId: string,
  ): Promise<{ storagePath: string }> {
    if (!file?.buffer) {
      throw new BadRequestException('Audio file is required');
    }
    if (!ALLOWED_AUDIO_MIMETYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid audio type. Allowed: ${ALLOWED_AUDIO_MIMETYPES.join(', ')}`,
      );
    }
    if (file.size && file.size > MAX_AUDIO_SIZE_BYTES) {
      throw new BadRequestException(
        `Audio too large. Maximum size is ${MAX_AUDIO_SIZE_BYTES / (1024 * 1024)}MB`,
      );
    }

    const extension = this.getAudioExtension(file.mimetype, file.originalname);
    const storagePath = `${userId}/music/${randomUUID()}.${extension}`;
    const { error } = await this.supabaseService
      .getServiceRoleClient()
      .storage
      .from('source-videos')
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (error) {
      throw new BadRequestException(`Failed to upload audio: ${error.message}`);
    }

    return { storagePath };
  }

  async initUpload(
    userId: string,
    fileName: string,
    fileSize: number,
    mimeType: string,
  ): Promise<{ uploadId: string }> {
    if (!ALLOWED_VIDEO_MIMETYPES.includes(mimeType)) {
      throw new BadRequestException(
        `Invalid file type. Allowed: ${ALLOWED_VIDEO_MIMETYPES.join(', ')}`,
      );
    }

    if (fileSize > MAX_VIDEO_SIZE_BYTES) {
      throw new BadRequestException(
        `File too large. Maximum size is ${MAX_VIDEO_SIZE_BYTES / (1024 * 1024)}MB`,
      );
    }

    const uploadId = randomUUID();
    const extension = this.getExtensionFromMimeType(mimeType);
    const tempDir = join(process.env.TMPDIR || '/tmp', `upload-${uploadId}`);

    mkdirSync(tempDir, { recursive: true });

    // Estimate total chunks (assuming 5MB chunks)
    const chunkSize = 5 * 1024 * 1024;
    const totalChunks = Math.ceil(fileSize / chunkSize);

    this.uploads.set(uploadId, {
      userId,
      fileName,
      fileSize,
      mimeType,
      extension,
      totalChunks,
      chunks: new Map(),
      tempDir,
    });

    return { uploadId };
  }

  async uploadChunk(
    uploadId: string,
    userId: string,
    chunkIndex: number,
    chunk: Buffer,
  ): Promise<{ received: number; total: number }> {
    const metadata = this.uploads.get(uploadId);
    if (!metadata) {
      throw new BadRequestException('Upload not found or expired');
    }
    if (metadata.userId !== userId) {
      throw new ForbiddenException('Upload does not belong to this user');
    }

    const chunkPath = join(metadata.tempDir, `chunk-${chunkIndex}`);
    await this.writeChunkToFile(chunkPath, chunk);
    metadata.chunks.set(chunkIndex, chunkPath);

    return {
      received: metadata.chunks.size,
      total: metadata.totalChunks,
    };
  }

  async completeUpload(
    uploadId: string,
    userId: string,
    checksum?: string,
  ): Promise<{ videoUrl: string }> {
    const metadata = this.uploads.get(uploadId);
    if (!metadata) {
      throw new BadRequestException('Upload not found or expired');
    }
    if (metadata.userId !== userId) {
      throw new ForbiddenException('Upload does not belong to this user');
    }

    const outputPath = join(metadata.tempDir, 'output.' + metadata.extension);

    // Assemble chunks
    await this.assembleChunks(metadata, outputPath);

    // Verify checksum if provided
    if (checksum) {
      const calculatedChecksum = await this.calculateMd5(outputPath);
      if (calculatedChecksum !== checksum.toLowerCase()) {
        unlinkSync(outputPath);
        throw new BadRequestException('Checksum mismatch');
      }
    }

    // Upload to Supabase Storage
    const videoUrl = await this.uploadToSupabase(
      outputPath,
      userId,
      uploadId,
      metadata.extension,
    );

    // Cleanup
    this.cleanup(metadata);

    return { videoUrl };
  }

  getExtensionFromMimeType(mimetype: string): string {
    const extensionMap: Record<string, string> = {
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'video/webm': 'webm',
      'video/x-m4v': 'm4v',
      'video/x-matroska': 'mkv',
    };
    return extensionMap[mimetype] || 'mp4';
  }

  private getAudioExtension(mimetype: string, fileName?: string): string {
    const extensionMap: Record<string, string> = {
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
      'audio/aac': 'aac',
      'audio/mp4': 'm4a',
      'audio/m4a': 'm4a',
      'audio/x-m4a': 'm4a',
      'audio/ogg': 'ogg',
      'audio/webm': 'webm',
    };
    if (extensionMap[mimetype]) return extensionMap[mimetype];

    const match = fileName?.match(/\.([a-z0-9]{1,8})$/i);
    return match ? match[1].toLowerCase() : 'mp3';
  }

  private async writeChunkToFile(path: string, data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const stream = createWriteStream(path);
      stream.write(data, () => {
        stream.end();
        stream.on('finish', resolve);
        stream.on('error', reject);
      });
    });
  }

  private async assembleChunks(metadata: UploadMetadata, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const writeStream = createWriteStream(outputPath);
      const sortedIndices = Array.from(metadata.chunks.keys()).sort((a, b) => a - b);

      let currentIndex = 0;

      const writeNext = () => {
        if (currentIndex >= sortedIndices.length) {
          writeStream.end();
          return;
        }

        const chunkPath = metadata.chunks.get(sortedIndices[currentIndex]);
        const readStream = createReadStream(chunkPath!);

        readStream.on('data', (chunk) => {
          writeStream.write(chunk);
        });

        readStream.on('end', () => {
          currentIndex++;
          writeNext();
        });

        readStream.on('error', reject);
      };

      writeStream.on('finish', resolve);
      writeStream.on('error', reject);

      writeNext();
    });
  }

  private async calculateMd5(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('md5');
      const stream = createReadStream(filePath);

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  private async uploadToSupabase(
    filePath: string,
    userId: string,
    uploadId: string,
    extension: string,
  ): Promise<string> {
    const client = this.supabaseService.getServiceRoleClient();
    const bucket = 'source-videos';
    const destinationPath = `${userId}/${uploadId}/input.${extension}`;

    const fileBuffer = await this.readFileBuffer(filePath);

    const { error } = await client.storage
      .from(bucket)
      .upload(destinationPath, fileBuffer, {
        contentType: 'video/' + extension.replace('video/', ''),
        upsert: true,
      });

    if (error) {
      throw new BadRequestException(`Failed to upload to storage: ${error.message}`);
    }

    const { data: urlData, error: signError } = await client.storage
      .from(bucket)
      .createSignedUrl(destinationPath, 3600);

    if (signError || !urlData?.signedUrl) {
      throw new BadRequestException(`Failed to sign uploaded video: ${signError?.message}`);
    }

    return urlData.signedUrl;
  }

  private async readFileBuffer(filePath: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = createReadStream(filePath);

      stream.on('data', (chunk: any) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  private cleanup(metadata: UploadMetadata): void {
    try {
      if (existsSync(metadata.tempDir)) {
        for (const chunkPath of metadata.chunks.values()) {
          if (existsSync(chunkPath)) unlinkSync(chunkPath);
        }
        const outputPath = join(metadata.tempDir, 'output.' + metadata.extension);
        if (existsSync(outputPath)) unlinkSync(outputPath);
      }
    } catch {
      // Ignore cleanup errors
    } finally {
      for (const [key, val] of this.uploads.entries()) {
        if (val.tempDir === metadata.tempDir) {
          this.uploads.delete(key);
          break;
        }
      }
    }
  }
}
