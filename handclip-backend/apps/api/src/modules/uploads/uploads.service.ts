import { Injectable, BadRequestException, OnModuleDestroy } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { createReadStream, existsSync, unlinkSync, mkdirSync, readFileSync, appendFileSync, promises as fs } from 'fs';
import { pipeline } from 'stream/promises';
import { join } from 'path';
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
  private cleanupInterval: NodeJS.Timeout;

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
    userId: string,
  ): Promise<{ received: number; total: number }> {
    this.cleanExpiredUploads();
    const metadata = this.uploads.get(uploadId);
    if (!metadata) {
      throw new BadRequestException('Upload not found or expired');
    }
    // defense-in-depth: chunk upload only for the session owner
    if (metadata.userId !== userId) {
      throw new BadRequestException('Upload not found or expired');
    }

    if (chunkIndex < 0 || chunkIndex >= metadata.totalChunks) {
      throw new BadRequestException(`Invalid chunk index: ${chunkIndex}. Expected 0-${metadata.totalChunks - 1}`);
    }

    const chunkPath = join(metadata.tempDir, `chunk-${chunkIndex}`);
    await fs.writeFile(chunkPath, chunk);
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
    this.assembleChunks(metadata, outputPath);

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
    this.cleanup(metadata, uploadId);

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

  private assembleChunks(metadata: UploadMetadata, outputPath: string): void {
    const sorted = [...metadata.chunks.keys()].sort((a, b) => a - b);
    for (const idx of sorted) {
      appendFileSync(outputPath, readFileSync(metadata.chunks.get(idx)!));
    }
  }

  private async calculateMd5(filePath: string): Promise<string> {
    const hash = createHash('md5');
    await pipeline(createReadStream(filePath), hash);
    return hash.digest('hex');
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

    const fileBuffer = await fs.readFile(filePath);

    const { error } = await client.storage
      .from(bucket)
      .upload(destinationPath, fileBuffer, {
        contentType: 'video/' + extension.replace('video/', ''),
        upsert: true,
        // ponytail: cap upload at 120s; createSignedUrl/getPublicUrl are fast metadata ops and don't need timeouts
        signal: AbortSignal.timeout(120_000),
      } as { contentType: string; upsert: boolean; signal: AbortSignal });

    if (error) {
      console.error('Failed to upload file to storage:', error);
      throw new BadRequestException('Failed to upload file to storage');
    }

    const { data: urlData } = client.storage.from(bucket).getPublicUrl(destinationPath);

    return urlData.publicUrl;
  }

  private cleanup(metadata: UploadMetadata, uploadId: string): void {
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
      this.uploads.delete(uploadId);
      this.uploadTimestamps.delete(uploadId);
    }
  }

  private cleanExpiredUploads(): void {
    const now = Date.now();
    const TTL = 30 * 60 * 1000; // 30 minutes
    for (const [uploadId, timestamp] of this.uploadTimestamps.entries()) {
      if (now - timestamp > TTL) {
        const metadata = this.uploads.get(uploadId);
        if (metadata) {
          this.cleanup(metadata, uploadId);
        } else {
          this.uploadTimestamps.delete(uploadId);
        }
      }
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupInterval);
  }
}
