import { JobsService } from './jobs.service';

describe('JobsService analysis pipeline', () => {
  it('tracks analysis through one database job passed to transcription', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'bull-transcription-1' });
    const updateEq = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn(() => ({ eq: updateEq }));
    const insert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn().mockResolvedValue({
          data: { id: 'tracking-job-1' },
          error: null,
        }),
      })),
    }));
    const from = jest.fn(() => ({ insert, update }));
    const service = new JobsService(
      { add } as any,
      {} as any,
      {} as any,
      { getServiceRoleClient: () => ({ from }) } as any,
    );

    await expect(
      service.enqueueAnalysis('project-1', 'user-1', 'https://signed.example/video'),
    ).resolves.toEqual(
      expect.objectContaining({
        jobId: 'tracking-job-1',
      }),
    );
    expect(insert).toHaveBeenCalledWith({
      project_id: 'project-1',
      type: 'clip_analysis',
      status: 'queued',
      progress: 0,
      result: { pipeline: 'analysis' },
    });
    expect(add).toHaveBeenCalledWith(
      'transcribe',
      expect.objectContaining({
        projectId: 'project-1',
        userId: 'user-1',
        trackingJobId: 'tracking-job-1',
      }),
      expect.any(Object),
    );
    expect(update).toHaveBeenCalledWith({ bullmq_id: 'bull-transcription-1' });
    expect(updateEq).toHaveBeenCalledWith('id', 'tracking-job-1');
  });
});
