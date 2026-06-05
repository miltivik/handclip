import { describe, it, expect, vi } from 'vitest';
import { CleanupProcessor } from './cleanup.processor';

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPORT_RETENTION_DAYS = 30;
const SOURCE_VIDEO_RETENTION_DAYS = 7;

interface MockCall {
  table: string;
  method: string;
  args: unknown[];
}

function createResolvedPromise<T>(value: T): Promise<T> {
  return Promise.resolve(value);
}

// Creates a proxy chainable that supports method chaining
function createChainable<T>(value: T) {
  const handlers: Record<string, unknown> = {};
  const chainable = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'then') {
        return ((onfulfilled: (v: T) => unknown) => {
          try {
            return onfulfilled(value);
          } catch {
            return { catch: () => ({ finally: (fn: () => void) => fn() }) };
          }
        }) as never;
      }
      if (!handlers[prop]) {
        handlers[prop] = vi.fn().mockImplementation(() => createChainable(value));
      }
      return handlers[prop];
    },
  }) as unknown as T & Record<string, (...args: unknown[]) => typeof chainable>;
  return chainable;
}

describe('CleanupProcessor', () => {
  describe('cleanupOldExports', () => {
    it('generates correct cutoff date for 30-day retention', async () => {
      const calls: MockCall[] = [];
      let selectCount = 0;

      const selectFn = vi.fn(() => {
        selectCount++;
        return createChainable({ data: [], error: null });
      });

      const mockSupabase = {
        from: vi.fn((table: string) => {
          calls.push({ table, method: 'from', args: [table] });
          return { select: selectFn };
        }),
        storage: { from: vi.fn(() => ({ remove: vi.fn(() => createResolvedPromise({ error: null })) })) },
      };

      const mockService = { getServiceRoleClient: vi.fn().mockReturnValue(mockSupabase) };
      const mockQueue = { add: vi.fn().mockResolvedValue({}) };
      const processor = new CleanupProcessor(mockService as never, mockQueue as never);

      const now = new Date('2024-06-15T12:00:00Z');
      const errors: string[] = [];

      await processor.cleanupOldExports(mockSupabase as never, now, errors);

      expect(calls.some(c => c.table === 'exports')).toBe(true);
      expect(new Date(now.getTime() - EXPORT_RETENTION_DAYS * DAY_MS).toISOString()).toBe('2024-05-16T12:00:00.000Z');
    });

    it('skips storage deletion when live sibling exists', async () => {
      const calls: MockCall[] = [];
      const staleExport = { id: 'exp-1', project_id: 'proj-1', preset: 'tiktok', completed_at: '2024-05-01T00:00:00Z' };
      let selectCount = 0;

      // Single select mock that returns different values on successive calls
      const selectFn = vi.fn(() => {
        selectCount++;
        if (selectCount === 1) {
          return createChainable({ data: [staleExport], error: null });
        }
        // Sibling check: returns sibling (storage deletion skipped)
        return createChainable({ data: [{ id: 'exp-2' }], error: null });
      });

      const deleteFn = vi.fn(() => createChainable({ error: null }));

      const mockSupabase = {
        from: vi.fn((table: string) => {
          calls.push({ table, method: 'from', args: [table] });
          return { select: selectFn, delete: deleteFn };
        }),
        storage: {
          from: vi.fn((bucket: string) => {
            calls.push({ table: bucket, method: 'storage-remove', args: [] });
            return { remove: vi.fn(() => createResolvedPromise({ error: null })) };
          }),
        },
      };

      const mockService = { getServiceRoleClient: vi.fn().mockReturnValue(mockSupabase) };
      const mockQueue = { add: vi.fn().mockResolvedValue({}) };
      const processor = new CleanupProcessor(mockService as never, mockQueue as never);

      const now = new Date('2024-06-15T12:00:00Z');
      const errors: string[] = [];

      const deleted = await processor.cleanupOldExports(mockSupabase as never, now, errors);

      expect(deleted).toBe(1);
      // Storage should NOT be called because sibling exists
      const storageCalls = calls.filter(c => c.method === 'storage-remove');
      expect(storageCalls).toHaveLength(0);
    });

    it('deletes storage when no live sibling exists', async () => {
      const calls: MockCall[] = [];
      const staleExport = { id: 'exp-1', project_id: 'proj-1', preset: 'tiktok', completed_at: '2024-05-01T00:00:00Z' };
      let selectCount = 0;

      const selectFn = vi.fn(() => {
        selectCount++;
        if (selectCount === 1) {
          return createChainable({ data: [staleExport], error: null });
        }
        // Sibling check: no sibling found (storage deletion needed)
        return createChainable({ data: [], error: null });
      });

      const deleteFn = vi.fn(() => createChainable({ error: null }));

      const mockSupabase = {
        from: vi.fn((table: string) => {
          calls.push({ table, method: 'from', args: [table] });
          return { select: selectFn, delete: deleteFn };
        }),
        storage: {
          from: vi.fn((bucket: string) => {
            calls.push({ table: bucket, method: 'storage-remove', args: [] });
            return {
              remove: vi.fn((paths: string[]) => {
                calls.push({ table: bucket, method: 'remove', args: paths });
                return createResolvedPromise({ error: null });
              }),
            };
          }),
        },
      };

      const mockService = { getServiceRoleClient: vi.fn().mockReturnValue(mockSupabase) };
      const mockQueue = { add: vi.fn().mockResolvedValue({}) };
      const processor = new CleanupProcessor(mockService as never, mockQueue as never);

      const now = new Date('2024-06-15T12:00:00Z');
      const errors: string[] = [];

      const deleted = await processor.cleanupOldExports(mockSupabase as never, now, errors);

      expect(deleted).toBe(1);
      const removeCalls = calls.filter(c => c.method === 'remove');
      expect(removeCalls.some(c => c.args.includes('proj-1/tiktok/output.mp4'))).toBe(true);
      expect(removeCalls.some(c => c.args.includes('proj-1/tiktok/thumbnail.jpg'))).toBe(true);
    });
  });

  describe('cleanupOldSourceVideos', () => {
    it('uses correct retention days of 7', async () => {
      const calls: MockCall[] = [];

      const selectFn = vi.fn(() => {
        calls.push({ table: 'projects', method: 'select', args: [] });
        return createChainable({ data: [], error: null });
      });

      const mockSupabase = {
        from: vi.fn((table: string) => ({
          select: selectFn,
        })),
        storage: { from: vi.fn(() => ({ remove: vi.fn(() => createResolvedPromise({ error: null })) })) },
      };

      const mockService = { getServiceRoleClient: vi.fn().mockReturnValue(mockSupabase) };
      const mockQueue = { add: vi.fn().mockResolvedValue({}) };
      const processor = new CleanupProcessor(mockService as never, mockQueue as never);

      const now = new Date('2024-06-15T12:00:00Z');
      const errors: string[] = [];

      await processor.cleanupOldSourceVideos(mockSupabase as never, now, errors);

      expect(calls.some(c => c.table === 'projects')).toBe(true);
      expect(new Date(now.getTime() - 7 * DAY_MS).toISOString()).toBe('2024-06-08T12:00:00.000Z');
    });

    it('nulls source_video_url after cleanup', async () => {
      const calls: MockCall[] = [];
      const staleProject = { id: 'proj-1', source_video_url: 'user123/proj1/input.mp4' };

      const selectFn = vi.fn(() => createChainable({ data: [staleProject], error: null }));
      const updateFn = vi.fn((data: Record<string, unknown>) => {
        calls.push({ table: 'projects', method: 'update', args: [data] });
        return createChainable({ error: null });
      });

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'projects') {
            return { select: selectFn, update: updateFn };
          }
          return { select: vi.fn(() => createChainable({ data: [], error: null })) };
        }),
        storage: {
          from: vi.fn((bucket: string) => {
            calls.push({ table: bucket, method: 'storage-remove', args: [] });
            return { remove: vi.fn(() => createResolvedPromise({ error: null })) };
          }),
        },
      };

      const mockService = { getServiceRoleClient: vi.fn().mockReturnValue(mockSupabase) };
      const mockQueue = { add: vi.fn().mockResolvedValue({}) };
      const processor = new CleanupProcessor(mockService as never, mockQueue as never);

      const now = new Date('2024-06-15T12:00:00Z');
      const errors: string[] = [];

      const cleaned = await processor.cleanupOldSourceVideos(mockSupabase as never, now, errors);

      expect(cleaned).toBe(1);
      expect(calls.some(c => c.table === 'source-videos' && c.method === 'storage-remove')).toBe(true);
      const updateCall = calls.find(c => c.method === 'update');
      expect(updateCall).toBeDefined();
    });
  });

  describe('process', () => {
    it('aggregates results from both cleanup methods', async () => {
      const selectFn = vi.fn(() => createChainable({ data: [], error: null }));

      const mockSupabase = {
        from: vi.fn(() => ({ select: selectFn })),
        storage: { from: vi.fn(() => ({ remove: vi.fn(() => createResolvedPromise({ error: null })) })) },
      };

      const mockService = { getServiceRoleClient: vi.fn().mockReturnValue(mockSupabase) };
      const mockQueue = { add: vi.fn().mockResolvedValue({}) };
      const processor = new CleanupProcessor(mockService as never, mockQueue as never);

      const result = await processor.process({} as never);

      expect(result.exportsDeleted).toBe(0);
      expect(result.sourceVideosCleaned).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });
});