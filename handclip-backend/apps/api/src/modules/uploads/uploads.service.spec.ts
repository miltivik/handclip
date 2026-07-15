import { BadRequestException } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { SupabaseService } from '../supabase/supabase.service';

// Supabase is never reached in these tests (all 3 throws happen before uploadToSupabase).
// Cast satisfies the constructor; the methods we exercise don't call into it.
const mockSupabase = {} as unknown as SupabaseService;

describe('UploadsService (Phase 1 regressions)', () => {
  let service: UploadsService;

  beforeEach(() => {
    service = new UploadsService(mockSupabase);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('initUpload — per-user concurrent cap (DoS prevention)', () => {
    it('rejects the 6th initUpload from the same user', async () => {
      for (let i = 0; i < 5; i++) {
        await service.initUpload('user-1', `f${i}.mp4`, 1024, 'video/mp4');
      }
      await expect(
        service.initUpload('user-1', 'f6.mp4', 1024, 'video/mp4'),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not cap across different users', async () => {
      for (let i = 0; i < 5; i++) {
        await service.initUpload('user-A', `a${i}.mp4`, 1024, 'video/mp4');
      }
      const { uploadId } = await service.initUpload('user-B', 'b.mp4', 1024, 'video/mp4');
      expect(uploadId).toBeDefined();
    });
  });

  describe('completeUpload — ownership check (defense-in-depth)', () => {
    it('rejects when userId does not match the upload owner', async () => {
      const { uploadId } = await service.initUpload('owner-1', 'f.mp4', 1024, 'video/mp4');
      await expect(
        service.completeUpload(uploadId, 'attacker-2', 'token'),
      ).rejects.toThrow(/Upload not found or expired/);
    });
  });

  describe('completeUpload — missing chunks integrity check', () => {
    it('rejects when not all chunks were received', async () => {
      // fileSize 1024 < CHUNK_UPLOAD_SIZE_BYTES → totalChunks = 1, 0 sent
      const { uploadId } = await service.initUpload('user-1', 'f.mp4', 1024, 'video/mp4');
      await expect(
        service.completeUpload(uploadId, 'user-1', 'token'),
      ).rejects.toThrow(/Missing chunks: received 0 of 1/);
    });
  });
});
