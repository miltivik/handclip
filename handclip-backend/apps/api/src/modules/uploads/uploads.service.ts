import { Injectable, BadRequestException } from '@nestjs/common';
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
    chunkIndex: number,
    chunk: Buffer,
  ): Promise<{ received: number; total: number }> {
    const metadata = this.uploads.get(uploadId);
    if (!metadata) {
      throw new BadRequestException('Upload not found or expired');
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
    const videoUrl = await this.uploadToSupabase(outputPath, uploadId, metadata.extension);

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
  ): Promise<string> {
    const client = this.supabaseService.getServiceRoleClient();
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
      throw new BadRequestException(`Failed to upload to storage: ${error.message}`);
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
          break;
        }
      }
    }
  }
}