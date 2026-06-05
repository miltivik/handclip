import { create } from 'zustand';
import type * as ZustandMiddleware from 'zustand/middleware';
import { api, Project, ClipCandidate } from '../services/api';
import { safeStorage } from '../lib/safe-storage';

declare const require: <T>(name: string) => T;

const { createJSONStorage, persist } =
  require<typeof ZustandMiddleware>('zustand/middleware');

export interface SubtitleSegment {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  words?: { word: string; start: number; end: number; probability: number }[];
}

interface ProjectState {
  currentProject: Project | null;
  clips: ClipCandidate[];
  selectedClipId: string | null;
  isLoading: boolean;
  error: string | null;
  subtitles: SubtitleSegment[];
  subtitlesLoading: boolean;

  // Actions
  setProject: (project: Project) => void;
  setClips: (clips: ClipCandidate[]) => void;
  selectClip: (clipId: string | null) => void;
  clearProject: () => void;
  fetchProject: (projectId: string) => Promise<void>;
  fetchClips: (projectId: string) => Promise<void>;
  fetchSubtitles: (projectId: string, clipId: string) => Promise<void>;
  toggleClipSelection: (projectId: string, clipId: string, selected: boolean) => Promise<void>;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      currentProject: null,
      clips: [],
      selectedClipId: null,
      isLoading: false,
      error: null,
      subtitles: [],
      subtitlesLoading: false,

      setProject: (project) => set({ currentProject: project }),

      setClips: (clips) => set({ clips }),

      selectClip: (clipId) => set({ selectedClipId: clipId }),

      clearProject: () =>
        set({ currentProject: null, clips: [], selectedClipId: null, subtitles: [], error: null }),

      fetchProject: async (projectId: string) => {
        set({ isLoading: true, error: null });
        try {
          const project = await api.getProject(projectId);
          set({ currentProject: project, isLoading: false });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Error loading project';
          set({ error: message, isLoading: false });
        }
      },

      fetchClips: async (projectId: string) => {
        set({ isLoading: true, error: null });
        try {
          const clips = await api.getClips(projectId);
          set({ clips, isLoading: false });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Error loading clips';
          set({ error: message, isLoading: false });
        }
      },

      fetchSubtitles: async (projectId: string, clipId: string) => {
        set({ subtitlesLoading: true, error: null });
        try {
          const subtitles = await api.getSubtitles(projectId, clipId);
          set({ subtitles, subtitlesLoading: false });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Error loading subtitles';
          set({ error: message, subtitlesLoading: false });
        }
      },

      toggleClipSelection: async (projectId: string, clipId: string, selected: boolean) => {
        const prevClips = get().clips;
        // Optimistic update
        set({
          clips: prevClips.map((c) =>
            c.id === clipId ? { ...c, selected } : c,
          ),
        });
        try {
          await api.selectClip(projectId, clipId, selected);
        } catch {
          // Rollback on error
          set({ clips: prevClips });
        }
      },
    }),
    {
      name: 'handclip-project-cache',
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({
        currentProject: state.currentProject,
        clips: state.clips,
        subtitles: state.subtitles,
      }),
    }
  )
);
