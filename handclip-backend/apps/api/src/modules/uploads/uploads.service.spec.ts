import { BadRequestException } from '@nestjs/common';
import { UploadsService } from './uploads.service';

function buildStorageMock() {
  const upload = jest.fn().mockResolvedValue({ error: null });
  const from = jest.fn(() => ({ upload }));
  const supabase = {
    getServiceRoleClient: jest.fn(() => ({
      storage: { from },
    })),
  };
  return { supabase, from, upload };
}

describe('UploadsService audio uploads', () => {
  it('uploads audio to source-videos under the authenticated user music prefix', async () => {
    const { supabase, from, upload } = buildStorageMock();
    const service = new UploadsService(supabase as any);

    const result = await service.uploadAudio(
      { buffer: Buffer.from('mp3'), mimetype: 'audio/mpeg', originalname: 'theme.mp3' } as any,
      'user-1',
    );

    expect(result.storagePath).toMatch(/^user-1\/music\/.+\.mp3$/);
    expect(from).toHaveBeenCalledWith('source-videos');
    expect(upload).toHaveBeenCalledWith(
      result.storagePath,
      Buffer.from('mp3'),
      expect.objectContaining({ contentType: 'audio/mpeg', upsert: false }),
    );
  });

  it('rejects non-audio uploads', async () => {
    const { supabase } = buildStorageMock();
    const service = new UploadsService(supabase as any);

    await expect(
      service.uploadAudio(
        { buffer: Buffer.from('not audio'), mimetype: 'text/plain', originalname: 'notes.txt' } as any,
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
