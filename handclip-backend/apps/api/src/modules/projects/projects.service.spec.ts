import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SupabaseService } from '../supabase/supabase.service';
import { ProjectsService } from './projects.service';

function buildSupabaseMock() {
  const queue: any[] = [];
  const make = () => {
    const chain: any = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(),
    };
    return chain;
  };
  const from = jest.fn(() => {
    if (queue.length > 0) {
      return queue.shift();
    }
    return make();
  });
  return {
    getServiceRoleClient: jest.fn(() => ({ from })),
    getClient: jest.fn(() => ({ from })),
    queueChain: () => {
      const chain = make();
      queue.push(chain);
      return chain;
    },
  };
}

describe('ProjectsService ownership', () => {
  it('returns the project when the owner matches', async () => {
    const supabase = buildSupabaseMock();
    const chain = supabase.queueChain();
    chain.select.mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { id: 'project-1', user_id: 'owner-user' },
            error: null,
          }),
        }),
      }),
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: SupabaseService, useValue: supabase },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn() } },
      ],
    }).compile();
    const service = moduleRef.get(ProjectsService);
    await expect(service.assertOwnedBy('project-1', 'owner-user')).resolves.toEqual(
      expect.objectContaining({ id: 'project-1', user_id: 'owner-user' }),
    );
  });

  it('throws NotFound when owner does not match', async () => {
    const supabase = buildSupabaseMock();
    const chain = supabase.queueChain();
    chain.select.mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: null,
            error: { code: 'PGRST116', message: 'no rows' },
          }),
        }),
      }),
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: SupabaseService, useValue: supabase },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn() } },
      ],
    }).compile();
    const service = moduleRef.get(ProjectsService);
    await expect(service.assertOwnedBy('project-1', 'other-user')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
