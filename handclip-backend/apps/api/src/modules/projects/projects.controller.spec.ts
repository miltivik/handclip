import { BadRequestException } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { JobsService } from '../jobs/jobs.service';

const mockUser = { id: 'user-1' };
const mockVideoUrl = 'https://signed.example/video.mp4';

function buildController(overrides?: {
  projectsService?: Partial<ProjectsService>;
  jobsService?: Partial<JobsService>;
}) {
  return new ProjectsController(
    {
      getVideoUrl: jest.fn().mockResolvedValue(mockVideoUrl),
      assertOwnedBy: jest.fn().mockResolvedValue(undefined),
      ...overrides?.projectsService,
    } as unknown as ProjectsService,
    {
      enqueueRender: jest.fn().mockResolvedValue({ jobId: 'job-1' }),
      ...overrides?.jobsService,
    } as unknown as JobsService,
  );
}

function buildBody(overrides?: Record<string, unknown>) {
  return {
    clipId: 'clip-1',
    trimStart: 0,
    trimEnd: 30,
    subtitles: [],
    preset: 'tiktok' as const,
    ...overrides,
  };
}

describe('ProjectsController exportClip', () => {
  describe('speed validation', () => {
    it('defaults speed to 1 when missing and enqueues', async () => {
      const controller = buildController();
      await controller.exportClip(mockUser as any, 'project-1', buildBody());
      expect(controller['jobsService'].enqueueRender).toHaveBeenCalledWith(
        expect.objectContaining({ speed: 1 }),
      );
    });

    it('accepts speed 2 and enqueues it', async () => {
      const controller = buildController();
      await controller.exportClip(mockUser as any, 'project-1', buildBody({ speed: 2 }));
      expect(controller['jobsService'].enqueueRender).toHaveBeenCalledWith(
        expect.objectContaining({ speed: 2 }),
      );
    });

    it('accepts speed 0.5 and enqueues it', async () => {
      const controller = buildController();
      await controller.exportClip(mockUser as any, 'project-1', buildBody({ speed: 0.5 }));
      expect(controller['jobsService'].enqueueRender).toHaveBeenCalledWith(
        expect.objectContaining({ speed: 0.5 }),
      );
    });

    it('rejects speed 1.25 with BadRequestException', async () => {
      const controller = buildController();
      await expect(
        controller.exportClip(mockUser as any, 'project-1', buildBody({ speed: 1.25 })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects speed string "2" with BadRequestException', async () => {
      const controller = buildController();
      await expect(
        controller.exportClip(mockUser as any, 'project-1', buildBody({ speed: '2' as unknown as number })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects speed 3 with BadRequestException', async () => {
      const controller = buildController();
      await expect(
        controller.exportClip(mockUser as any, 'project-1', buildBody({ speed: 3 })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('textOverlay validation', () => {
    it('enqueues null when textOverlay is missing', async () => {
      const controller = buildController();
      await controller.exportClip(mockUser as any, 'project-1', buildBody());
      expect(controller['jobsService'].enqueueRender).toHaveBeenCalledWith(
        expect.objectContaining({ textOverlay: null }),
      );
    });

    it('enqueues null when textOverlay is undefined', async () => {
      const controller = buildController();
      await controller.exportClip(mockUser as any, 'project-1', buildBody({ textOverlay: undefined }));
      expect(controller['jobsService'].enqueueRender).toHaveBeenCalledWith(
        expect.objectContaining({ textOverlay: null }),
      );
    });

    it('accepts valid textOverlay with trimmed text', async () => {
      const controller = buildController();
      await controller.exportClip(mockUser as any, 'project-1', buildBody({
        textOverlay: { text: '  Hello World  ', position: 'center' },
      }));
      expect(controller['jobsService'].enqueueRender).toHaveBeenCalledWith(
        expect.objectContaining({ textOverlay: { text: 'Hello World', position: 'center' } }),
      );
    });

    it('normalizes empty trimmed text to null', async () => {
      const controller = buildController();
      await controller.exportClip(mockUser as any, 'project-1', buildBody({
        textOverlay: { text: '   ', position: 'top' },
      }));
      expect(controller['jobsService'].enqueueRender).toHaveBeenCalledWith(
        expect.objectContaining({ textOverlay: null }),
      );
    });

    it('rejects textOverlay text longer than 120 characters', async () => {
      const controller = buildController();
      const longText = 'a'.repeat(121);
      await expect(
        controller.exportClip(mockUser as any, 'project-1', buildBody({
          textOverlay: { text: longText, position: 'top' },
        })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts textOverlay text exactly 120 characters', async () => {
      const controller = buildController();
      const maxText = 'a'.repeat(120);
      await controller.exportClip(mockUser as any, 'project-1', buildBody({
        textOverlay: { text: maxText, position: 'bottom' },
      }));
      expect(controller['jobsService'].enqueueRender).toHaveBeenCalledWith(
        expect.objectContaining({ textOverlay: { text: maxText, position: 'bottom' } }),
      );
    });

    it('rejects invalid textOverlay position with BadRequestException', async () => {
      const controller = buildController();
      await expect(
        controller.exportClip(mockUser as any, 'project-1', buildBody({
          textOverlay: { text: 'Hello', position: 'middle' },
        })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects textOverlay as array with BadRequestException', async () => {
      const controller = buildController();
      await expect(
        controller.exportClip(mockUser as any, 'project-1', buildBody({
          textOverlay: ['not', 'an', 'object'],
        })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects textOverlay.text that is not a string', async () => {
      const controller = buildController();
      await expect(
        controller.exportClip(mockUser as any, 'project-1', buildBody({
          textOverlay: { text: 123 as unknown as string, position: 'top' },
        })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
