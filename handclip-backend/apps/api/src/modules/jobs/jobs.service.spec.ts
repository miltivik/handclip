import { JobsService } from './jobs.service';

interface MockChain {
  data: any;
  error: any;
}

/**
 * Returns a chainable object that resolves `value` from the terminal
 * `maybeSingle()` / `single()` call. Any intermediate PostgREST-style
 * method (eq, neq, in, not, order, limit) is also a chainable.
 */
function chainReturning(value: MockChain): any {
  const terminal = {
    single: async () => value,
    maybeSingle: async () => value,
  };
  const chain: any = { ...terminal };
  chain.select = () => chain;
  chain.insert = () => chain;
  chain.update = () => chain;
  chain.eq = () => chain;
  chain.neq = () => chain;
  chain.in = () => chain;
  chain.not = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  return chain;
}

function buildService(opts: {
  fromImpl: (table: string) => any;
  queues?: any;
}) {
  return new JobsService(
    opts.queues?.transcription ?? ({ add: jest.fn().mockResolvedValue({ id: 'bull-1' }) } as any),
    opts.queues?.clipAnalysis ?? ({} as any),
    opts.queues?.render ?? ({} as any),
    opts.queues?.editPrompt ?? ({ add: jest.fn().mockResolvedValue({ id: 'bull-edit-1' }) } as any),
    { getServiceRoleClient: () => ({ from: opts.fromImpl }) } as any,
  );
}

describe('JobsService analysis pipeline', () => {
  it('tracks analysis through one database job passed to transcription', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'bull-transcription-1' });
    const updateEq = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn(() => ({ eq: updateEq }));
    const insert = jest.fn(() => chainReturning({ data: { id: 'tracking-job-1' }, error: null }));
    const from = jest.fn(() => ({ insert, update }));
    const service = buildService({ fromImpl: from, queues: { transcription: { add } } });

    await expect(
      service.enqueueAnalysis('project-1', 'user-1', 'user-1/project-1/input.mp4'),
    ).resolves.toEqual(
      expect.objectContaining({ jobId: 'tracking-job-1' }),
    );
    expect(insert).toHaveBeenCalledWith({
      project_id: 'project-1',
      user_id: 'user-1',
      type: 'clip_analysis',
      status: 'queued',
      progress: 0,
      result: { pipeline: 'analysis' },
      client_request_id: null,
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

describe('JobsService idempotency', () => {
  it('enqueueAnalysis returns existing jobId for duplicate clientRequestId', async () => {
    const add = jest.fn();
    const insert = jest.fn();
    const from = jest.fn((table: string) => {
      if (table === 'jobs') {
        return {
          select: () => chainReturning({ data: { id: 'existing-job-1' }, error: null }),
          insert,
        };
      }
      return {};
    });
    const service = buildService({ fromImpl: from, queues: { transcription: { add } } });

    await expect(
      service.enqueueAnalysis('project-1', 'user-1', 'user-1/project-1/input.mp4', 'client-req-abc'),
    ).resolves.toEqual({ jobId: 'existing-job-1' });
    expect(add).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('enqueueRender returns existing jobId for duplicate clientRequestId', async () => {
    const add = jest.fn();
    const insert = jest.fn();
    const from = jest.fn((table: string) => {
      if (table === 'jobs') {
        return {
          select: () => chainReturning({ data: { id: 'existing-render-1' }, error: null }),
          insert,
        };
      }
      return {};
    });
    const service = buildService({ fromImpl: from, queues: { render: { add } } });

    const result = await service.enqueueRender({
      projectId: 'project-1',
      userId: 'user-1',
      sourceVideoPath: 'user-1/project-1/input.mp4',
      trimStart: 0,
      trimEnd: 30,
      subtitles: [],
      preset: 'tiktok',
      clientRequestId: 'client-render-1',
    });
    expect(result).toEqual({ jobId: 'existing-render-1' });
    expect(add).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('enqueueRender passes trackingJobId and sourceVideoPath to the queue worker', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'bull-render-1' });
    const updateEq = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn(() => ({ eq: updateEq }));
    const insert = jest.fn(() => chainReturning({ data: { id: 'render-row-1' }, error: null }));
    const from = jest.fn(() => ({ insert, update }));
    const service = buildService({ fromImpl: from, queues: { render: { add } } });

    const result = await service.enqueueRender({
      projectId: 'project-2',
      userId: 'user-2',
      sourceVideoPath: 'user-2/project-2/input.mp4',
      trimStart: 0,
      trimEnd: 30,
      subtitles: [],
      preset: 'tiktok',
    });
    expect(result).toEqual({ jobId: 'render-row-1' });
    expect(add).toHaveBeenCalledWith(
      'render-video',
      expect.objectContaining({ trackingJobId: 'render-row-1', sourceVideoPath: 'user-2/project-2/input.mp4' }),
      expect.any(Object),
    );
  });

  it('enqueueRender marks job failed when queue.add throws (no orphaned queued row)', async () => {
    const updateBodies: any[] = [];
    const add = jest.fn().mockRejectedValue(new Error('redis down'));
    const update = jest.fn((values: any) => {
      updateBodies.push(values);
      return { eq: jest.fn().mockResolvedValue({ error: null }) };
    });
    const insert = jest.fn(() => chainReturning({ data: { id: 'render-row-2' }, error: null }));
    const from = jest.fn(() => ({ insert, update }));
    const service = buildService({ fromImpl: from, queues: { render: { add } } });

    await expect(
      service.enqueueRender({
        projectId: 'p',
        userId: 'u',
        sourceVideoPath: 'u/p/input.mp4',
        trimStart: 0,
        trimEnd: 10,
        subtitles: [],
        preset: 'tiktok',
      }),
    ).rejects.toThrow(/redis down/);

    const markFailed = updateBodies.find(
      (b) => b && b.status === 'failed' && typeof b.result?.error === 'string' && /redis down/.test(b.result.error),
    );
    expect(markFailed).toBeDefined();
  });

  it('enqueueRender marks job failed when bullmq_id link update fails', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'bull-render-2' });
    const updateBodies: any[] = [];
    const update = jest.fn((values: any) => {
      updateBodies.push(values);
      if (values && 'bullmq_id' in values) {
        return { eq: jest.fn().mockResolvedValue({ error: { message: 'db down' } }) };
      }
      return { eq: jest.fn().mockResolvedValue({ error: null }) };
    });
    const insert = jest.fn(() => chainReturning({ data: { id: 'render-row-2' }, error: null }));
    const from = jest.fn(() => ({ insert, update }));
    const service = buildService({ fromImpl: from, queues: { render: { add } } });

    await expect(
      service.enqueueRender({
        projectId: 'p',
        userId: 'u',
        sourceVideoPath: 'u/p/input.mp4',
        trimStart: 0,
        trimEnd: 10,
        subtitles: [],
        preset: 'tiktok',
      }),
    ).rejects.toThrow(/link render job/);

    const markFailed = updateBodies.find((b) => b && b.status === 'failed' && typeof b.result?.error === 'string');
    expect(markFailed).toBeDefined();
  });

  it('enqueueAnalysis marks job failed when queue.add throws', async () => {
    const updateBodies: any[] = [];
    const add = jest.fn().mockRejectedValue(new Error('redis down'));
    const update = jest.fn((values: any) => {
      updateBodies.push(values);
      return { eq: jest.fn().mockResolvedValue({ error: null }) };
    });
    const insert = jest.fn(() => chainReturning({ data: { id: 'trans-row-1' }, error: null }));
    const from = jest.fn(() => ({ insert, update }));
    const service = buildService({ fromImpl: from, queues: { transcription: { add } } });

    await expect(
      service.enqueueAnalysis('p', 'u', 'u/p/input.mp4'),
    ).rejects.toThrow(/redis down/);

    const markFailed = updateBodies.find(
      (b) => b && b.status === 'failed' && typeof b.result?.error === 'string' && /redis down/.test(b.result.error),
    );
    expect(markFailed).toBeDefined();
  });

  it('enqueueAnalysis passes sourceVideoPath (not signed URL) to the worker', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'bull-transcription-2' });
    const updateEq = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn(() => ({ eq: updateEq }));
    const insert = jest.fn(() => chainReturning({ data: { id: 'trans-row-1' }, error: null }));
    const from = jest.fn(() => ({ insert, update }));
    const service = buildService({ fromImpl: from, queues: { transcription: { add } } });

    await service.enqueueAnalysis('project-x', 'user-x', 'user-x/project-x/input.mp4');
    expect(add).toHaveBeenCalledWith(
      'transcribe',
      expect.objectContaining({ sourceVideoPath: 'user-x/project-x/input.mp4' }),
      expect.any(Object),
    );
    const call = add.mock.calls[0][1] as any;
    expect(call.videoUrl).toBeUndefined();
  });
});

describe('JobsService listActiveJobsForUser', () => {
  it('returns only queued/active jobs for the user, sorted by updated_at desc', async () => {
    const from = jest.fn((table: string) => {
      if (table === 'jobs') {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                order: () => ({
                  limit: async () => ({
                    data: [
                      {
                        id: 'job-2',
                        project_id: 'p-2',
                        type: 'render',
                        status: 'active',
                        progress: 50,
                        result: null,
                        updated_at: '2025-01-02T00:00:00Z',
                        client_request_id: 'crr-2',
                      },
                      {
                        id: 'job-1',
                        project_id: 'p-1',
                        type: 'clip_analysis',
                        status: 'queued',
                        progress: 0,
                        result: { error: 'whisper down' },
                        updated_at: '2025-01-01T00:00:00Z',
                        client_request_id: null,
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });
    const service = buildService({ fromImpl: from });

    const result = await service.listActiveJobsForUser('user-1');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      jobId: 'job-2',
      projectId: 'p-2',
      type: 'render',
      status: 'ACTIVE',
      progress: 50,
      clientRequestId: 'crr-2',
    });
    expect(result[1]).toMatchObject({
      jobId: 'job-1',
      status: 'QUEUED',
      failedReason: 'whisper down',
    });
  });
});

describe('JobsService getLatestJobForProject', () => {
  it('returns null when no job exists for the project', async () => {
    const from = jest.fn((table: string) => {
      if (table === 'projects') {
        return {
          select: () => chainReturning({ data: { id: 'p' }, error: null }),
        };
      }
      if (table === 'jobs') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });
    const service = buildService({ fromImpl: from });
    const result = await service.getLatestJobForProject('p', 'user-1');
    expect(result).toBeNull();
  });
});

describe('JobsService enqueueEditPrompt', () => {
  it('creates a new edit-prompt row and enqueues the queue job with tracking id', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'bull-edit-1' });
    const updateBodies: any[] = [];
    const update = jest.fn((values: any) => {
      updateBodies.push(values);
      return { eq: jest.fn().mockResolvedValue({ error: null }) };
    });
    const insert = jest.fn(() => chainReturning({ data: { id: 'edit-row-1' }, error: null }));
    const from = jest.fn((table: string) => {
      if (table === 'jobs') {
        return {
          select: () => chainReturning({ data: null, error: null }),
          insert,
          update,
        };
      }
      return {};
    });
    const service = buildService({ fromImpl: from, queues: { editPrompt: { add } } });

    const result = await service.enqueueEditPrompt('project-1', 'user-1', 'Hazlo más rápido', 'client-edit-1');
    expect(result).toEqual({ jobId: 'edit-row-1' });
    // The queue job carries the tracking id and the user prompt.
    expect(add).toHaveBeenCalledWith(
      'apply-edit-prompt',
      { projectId: 'project-1', userId: 'user-1', prompt: 'Hazlo más rápido', trackingJobId: 'edit-row-1' },
      expect.objectContaining({ attempts: 2 }),
    );
    // The row is linked to the bullmq id, not marked failed.
    const linkUpdate = updateBodies.find((b) => b && b.bullmq_id === 'bull-edit-1');
    expect(linkUpdate).toBeDefined();
    const markFailed = updateBodies.find((b) => b && b.status === 'failed');
    expect(markFailed).toBeUndefined();
  });

  it('marks the row failed when the queue add throws', async () => {
    const add = jest.fn().mockRejectedValue(new Error('redis down'));
    const updateBodies: any[] = [];
    const update = jest.fn((values: any) => {
      updateBodies.push(values);
      return { eq: jest.fn().mockResolvedValue({ error: null }) };
    });
    const insert = jest.fn(() => chainReturning({ data: { id: 'edit-row-2' }, error: null }));
    const from = jest.fn((table: string) => {
      if (table === 'jobs') {
        return {
          select: () => chainReturning({ data: null, error: null }),
          insert,
          update,
        };
      }
      return {};
    });
    const service = buildService({ fromImpl: from, queues: { editPrompt: { add } } });

    await expect(
      service.enqueueEditPrompt('project-1', 'user-1', 'prompt', undefined),
    ).rejects.toThrow('redis down');
    const markFailed = updateBodies.find(
      (b) => b && b.status === 'failed' && typeof b.result?.error === 'string',
    );
    expect(markFailed).toBeDefined();
  });

  it('returns existing jobId when clientRequestId matches a non-terminal job', async () => {
    const add = jest.fn();
    const from = jest.fn(() => ({
      select: () => chainReturning({ data: { id: 'existing-edit' }, error: null }),
    }));
    const service = buildService({ fromImpl: from, queues: { editPrompt: { add } } });

    const result = await service.enqueueEditPrompt('project-1', 'user-1', 'prompt', 'crr');
    expect(result).toEqual({ jobId: 'existing-edit' });
    expect(add).not.toHaveBeenCalled();
  });
});
