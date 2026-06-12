import { Injectable, BadRequestException, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'crypto';
import { createWriteStream, createReadStream, existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import {
  ALLOWED_VIDEO_MIMETYPES,
  MAX_VIDEO_SIZE_BYTES,
  CHUNK_UPLOAD_SIZE_BYTES,
} from '@handclip/shared';

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
export class UploadsService implements OnModuleDestroy {
  private uploads = new Map<string, UploadMetadata>();
  private uploadTimestamps = new Map<string, number>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(private readonly supabaseService: SupabaseService) {
    this.cleanupInterval = setInterval(() => this.cleanExpiredUploads(), 5 * 60 * 1000);
  }

  async initUpload(
    userId: string,
    fileName: string,
    fileSize: number,
    mimeType: string,
  ): Promise<{ uploadId: string }> {
    this.cleanExpiredUploads();

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

    const totalChunks = Math.ceil(fileSize / CHUNK_UPLOAD_SIZE_BYTES);

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
    this.uploadTimestamps.set(uploadId, Date.now());

    return { uploadId };
  }

  async uploadChunk(
    uploadId: string,
    chunkIndex: number,
    chunk: Buffer,
  ): Promise<{ received: number; total: number }> {
    this.cleanExpiredUploads();
    const metadata = this.uploads.get(uploadId);
    if (!metadata) {
      throw new BadRequestException('Upload not found or expired');
    }

    if (chunkIndex < 0 || chunkIndex >= metadata.totalChunks) {
      throw new BadRequestException(`Invalid chunk index: ${chunkIndex}. Expected 0-${metadata.totalChunks - 1}`);
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
    token: string,
    checksum?: string,
  ): Promise<{ videoUrl: string }> {
    const metadata = this.uploads.get(uploadId);
    if (!metadata) {
      throw new BadRequestException('Upload not found or expired');
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

    const videoUrl = await this.uploadToSupabase(outputPath, uploadId, metadata.extension, token);

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
    uploadId: string,
    extension: string,
    token: string,
  ): Promise<string> {
    const client = this.supabaseService.getClientWithAuth(token);
    const bucket = 'source-videos';
    const destinationPath = `${uploadId}/input.${extension}`;

    const fileBuffer = await this.readFileBuffer(filePath);

    const { error } = await client.storage
      .from(bucket)
      .upload(destinationPath, fileBuffer, {
        contentType: 'video/' + extension.replace('video/', ''),
        upsert: true,
      });

    if (error) {
      console.error('Failed to upload file to storage:', error);
      throw new BadRequestException('Failed to upload file to storage');
    }

    const { data: urlData } = client.storage.from(bucket).getPublicUrl(destinationPath);

    return urlData.publicUrl;
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
          this.uploadTimestamps.delete(key);
          break;
        }
      }
    }
  }

  private cleanExpiredUploads(): void {
    const now = Date.now();
    const TTL = 30 * 60 * 1000; // 30 minutes
    for (const [uploadId, timestamp] of this.uploadTimestamps.entries()) {
      if (now - timestamp > TTL) {
        const metadata = this.uploads.get(uploadId);
        if (metadata) {
          this.cleanup(metadata);
        } else {
          this.uploadTimestamps.delete(uploadId);
        }
      }
    }
  }

  onModuleDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

}