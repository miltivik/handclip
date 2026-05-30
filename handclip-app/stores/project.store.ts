import { create } from 'zustand';
import { api, Project, ClipCandidate } from '../services/api';

interface ProjectState {
  currentProject: Project | null;
  clips: ClipCandidate[];
  selectedClipId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setProject: (project: Project) => void;
  setClips: (clips: ClipCandidate[]) => void;
  selectClip: (clipId: string | null) => void;
  clearProject: () => void;
  fetchProject: (projectId: string) => Promise<void>;
  fetchClips: (projectId: string) => Promise<void>;
  toggleClipSelection: (projectId: string, clipId: string, selected: boolean) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  currentProject: null,
  clips: [],
  selectedClipId: null,
  isLoading: false,
  error: null,

  setProject: (project) => set({ currentProject: project }),

  setClips: (clips) => set({ clips }),

  selectClip: (clipId) => set({ selectedClipId: clipId }),

  clearProject: () =>
    set({ currentProject: null, clips: [], selectedClipId: null }),

  fetchProject: async (projectId: string) => {
    set({ isLoading: true, error: null });
    try {
      const project = await api.getProject(projectId);
      set({ currentProject: project, isLoading: false });
    } catch (err: any) {
      set({ error: err?.message || 'Error loading project', isLoading: false });
    }
  },

  fetchClips: async (projectId: string) => {
    set({ isLoading: true, error: null });
    try {
      const clips = await api.getClips(projectId);
      set({ clips, isLoading: false });
    } catch (err: any) {
      set({ error: err?.message || 'Error loading clips', isLoading: false });
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
}));
