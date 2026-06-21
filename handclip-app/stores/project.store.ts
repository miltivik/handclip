import { create } from 'zustand';
import { api } from '../services/api';
import type { Project, ClipCandidate, SubtitleSegment } from '../services/api';

interface ProjectState {
  currentProject: Project | null;
  clips: ClipCandidate[];
  isLoading: boolean;
  error: string | null;
  subtitles: SubtitleSegment[];

  // Actions
  setClips: (clips: ClipCandidate[]) => void;
  fetchProject: (projectId: string) => Promise<void>;
  fetchClips: (projectId: string) => Promise<void>;
  fetchSubtitles: (projectId: string, clipId: string) => Promise<void>;
  toggleClipSelection: (projectId: string, clipId: string, selected: boolean) => Promise<void>;
}

const errorMessage = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

export const useProjectStore = create<ProjectState>((set, get) => ({
  currentProject: null,
  clips: [],
  isLoading: false,
  error: null,
  subtitles: [],

  setClips: (clips) => set({ clips }),

  fetchProject: async (projectId) => {
    set({ isLoading: true, error: null });
    try {
      const project = await api.getProject(projectId);
      set({ currentProject: project, isLoading: false });
    } catch (err) {
      set({ error: errorMessage(err, 'Error loading project'), isLoading: false });
    }
  },

  fetchClips: async (projectId) => {
    set({ isLoading: true, error: null });
    try {
      const clips = await api.getClips(projectId);
      set({ clips, isLoading: false });
    } catch (err) {
      set({ error: errorMessage(err, 'Error loading clips'), isLoading: false });
    }
  },

  fetchSubtitles: async (projectId, clipId) => {
    set({ error: null });
    try {
      const subtitles = await api.getSubtitles(projectId, clipId);
      set({ subtitles });
    } catch (err) {
      set({ error: errorMessage(err, 'Error loading subtitles') });
    }
  },

  toggleClipSelection: async (projectId, clipId, selected) => {
    const prevClips = get().clips;
    set({
      clips: prevClips.map((c) =>
        c.id === clipId ? { ...c, selected } : c,
      ),
    });
    try {
      await api.selectClip(projectId, clipId, selected);
    } catch {
      set({ clips: prevClips });
    }
  },
}));
