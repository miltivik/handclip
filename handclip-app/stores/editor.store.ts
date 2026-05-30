import { create } from 'zustand';

export interface Subtitle {
  text: string;
  startTime: number;
  endTime: number;
}

export type PresetType = 'tiktok' | 'reels' | 'shorts';

interface EditorState {
  selectedClipId: string | null;
  trimStart: number;
  trimEnd: number;
  subtitles: Subtitle[];
  preset: PresetType;
  undoStack: EditorSnapshot[];
  redoStack: EditorSnapshot[];
}

interface EditorSnapshot {
  trimStart: number;
  trimEnd: number;
  subtitles: Subtitle[];
}

interface EditorActions {
  setSelectedClip: (clipId: string) => void;
  setTrimStart: (value: number) => void;
  setTrimEnd: (value: number) => void;
  setSubtitles: (subtitles: Subtitle[]) => void;
  setPreset: (preset: PresetType) => void;
  undo: () => void;
  redo: () => void;
  pushUndo: () => void;
}

type EditorStore = EditorState & EditorActions;

const MAX_UNDO_STACK = 20;

export const useEditorStore = create<EditorStore>((set, get) => ({
  selectedClipId: null,
  trimStart: 0,
  trimEnd: 15,
  subtitles: [],
  preset: 'tiktok',
  undoStack: [],
  redoStack: [],

  setSelectedClip: (clipId) => set({ selectedClipId: clipId }),

  setTrimStart: (value) => {
    get().pushUndo();
    set({ trimStart: Math.max(0, value) });
  },

  setTrimEnd: (value) => {
    get().pushUndo();
    set({ trimEnd: value });
  },

  setSubtitles: (subtitles) => {
    get().pushUndo();
    set({ subtitles });
  },

  setPreset: (preset) => set({ preset }),

  pushUndo: () => {
    const { trimStart, trimEnd, subtitles, undoStack } = get();
    const snapshot: EditorSnapshot = { trimStart, trimEnd, subtitles };
    const newStack = [...undoStack, snapshot].slice(-MAX_UNDO_STACK);
    set({ undoStack: newStack, redoStack: [] });
  },

  undo: () => {
    const { undoStack, redoStack, trimStart, trimEnd, subtitles } = get();
    if (undoStack.length === 0) return;

    const previous = undoStack[undoStack.length - 1];
    const currentSnapshot: EditorSnapshot = { trimStart, trimEnd, subtitles };

    set({
      trimStart: previous.trimStart,
      trimEnd: previous.trimEnd,
      subtitles: previous.subtitles,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, currentSnapshot],
    });
  },

  redo: () => {
    const { undoStack, redoStack, trimStart, trimEnd, subtitles } = get();
    if (redoStack.length === 0) return;

    const next = redoStack[redoStack.length - 1];
    const currentSnapshot: EditorSnapshot = { trimStart, trimEnd, subtitles };

    set({
      trimStart: next.trimStart,
      trimEnd: next.trimEnd,
      subtitles: next.subtitles,
      undoStack: [...undoStack, currentSnapshot],
      redoStack: redoStack.slice(0, -1),
    });
  },
}));
