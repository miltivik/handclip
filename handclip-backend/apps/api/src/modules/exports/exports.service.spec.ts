import { Test } from '@nestjs/testing';
import { SupabaseService } from '../supabase/supabase.service';
import { ProjectsService } from '../projects/projects.service';
import { ExportsService, UserExport } from './exports.service';

function buildSupabaseMock() {
  const queue: unknown[] = [];
  let queueIndex = 0;
  const make = () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn(),
    };
    return chain;
  };
  const from = jest.fn(() => {
    if (queueIndex < queue.length) {
      return queue[queueIndex++] as ReturnType<typeof make>;
    }
    return make();
  });
  return {
    getServiceRoleClient: jest.fn(() => ({ from })),
    getClient: jest.fn(() => ({ from })),
    queueChain: (chain: unknown) => {
      queue.push(chain);
    },
    resetQueue: () => {
      queue.length = 0;
      queueIndex = 0;
    },
  };
}

describe('ExportsService.findCompletedByUser', () => {
  let service: ExportsService;
  let supabase: ReturnType<typeof buildSupabaseMock>;

  beforeEach(async () => {
    supabase = buildSupabaseMock();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ExportsService,
        { provide: SupabaseService, useValue: supabase },
        { provide: ProjectsService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(ExportsService);
  });

  it('filters by user_id via projects join', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnValue({
        data: [],
        error: null,
      }),
    };
    supabase.queueChain(chain);
    await service.findCompletedByUser('user-123');
    expect(chain.eq).toHaveBeenCalledWith('projects.user_id', 'user-123');
  });

  it('only returns completed exports', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnValue({
        data: [],
        error: null,
      }),
    };
    supabase.queueChain(chain);
    await service.findCompletedByUser('user-123');
    expect(chain.eq).toHaveBeenCalledWith('status', 'completed');
  });

  it('maps project title from joined projects', async () => {
    const mockData = [
      {
        id: 'export-1',
        project_id: 'project-1',
        clip_id: null,
        preset: 'mp4',
        status: 'completed',
        output_url: 'https://cdn.example/video.mp4',
        file_size: 1024000,
        duration: 30.5,
        created_at: '2024-01-01T00:00:00Z',
        completed_at: '2024-01-01T00:01:00Z',
        projects: { title: 'Mi Video' },
      },
    ];
    supabase.queueChain({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnValue({ data: mockData, error: null }),
    });

    const results = await service.findCompletedByUser('user-123');
    expect(results).toHaveLength(1);
    expect(results[0].project_title).toBe('Mi Video');
  });

  it('defaults null project title to "Proyecto sin nombre"', async () => {
    const mockData = [
      {
        id: 'export-2',
        project_id: 'project-2',
        clip_id: null,
        preset: 'mp4',
        status: 'completed',
        output_url: 'https://cdn.example/video2.mp4',
        file_size: null,
        duration: null,
        created_at: '2024-01-02T00:00:00Z',
        completed_at: null,
        projects: { title: null },
      },
    ];
    supabase.queueChain({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnValue({ data: mockData, error: null }),
    });

    const results = await service.findCompletedByUser('user-123');
    expect(results).toHaveLength(1);
    expect(results[0].project_title).toBe('Proyecto sin nombre');
  });

  it('returns empty array when no completed exports exist', async () => {
    supabase.queueChain({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnValue({ data: null, error: null }),
    });

    const results = await service.findCompletedByUser('user-123');
    expect(results).toEqual([]);
  });

  it('throws when database returns an error', async () => {
    supabase.queueChain({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnValue({ data: null, error: { message: 'DB error' } }),
    });

    await expect(service.findCompletedByUser('user-123')).rejects.toMatchObject({
      message: 'DB error',
    });
  });
});