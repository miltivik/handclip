import { create } from 'zustand';

export interface Subtitle {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
}

export type PresetType = 'tiktok' | 'reels' | 'shorts';

export type ExportSpeed = 0.5 | 1 | 2;

export type TextOverlayPosition = 'top' | 'center' | 'bottom';
export interface TextOverlay {
  text: string;
  position: TextOverlayPosition;
}

interface EditorState {
  selectedClipId: string | null;
  trimStart: number;
  trimEnd: number;
  subtitles: Subtitle[];
  preset: PresetType;
  undoStack: EditorSnapshot[];
  redoStack: EditorSnapshot[];
  speed: ExportSpeed;
  textOverlay: TextOverlay | null;
}

interface EditorSnapshot {
  trimStart: number;
  trimEnd: number;
  subtitles: Subtitle[];
  speed: ExportSpeed;
  textOverlay: TextOverlay | null;
}

interface EditorActions {
  setSelectedClip: (clipId: string) => void;
  setTrimStart: (value: number) => void;
  setTrimEnd: (value: number) => void;
  setSubtitles: (subtitles: Subtitle[]) => void;
  setPreset: (preset: PresetType) => void;
  setSpeed: (speed: ExportSpeed) => void;
  setTextOverlay: (overlay: TextOverlay | null) => void;
  undo: () => void;
  redo: () => void;
  pushUndo: () => void;
}

type EditorStore = EditorState & EditorActions;

const MAX_UNDO_STACK = 20;

export const useEditorStore = create<EditorStore>((set, get) => ({
  selectedClipId: null,
  trimStart: 0,
  trimEnd: 0,
  subtitles: [],
  preset: 'tiktok',
  undoStack: [],
  redoStack: [],
  speed: 1,
  textOverlay: null,

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

  setSpeed: (speed) => {
    get().pushUndo();
    set({ speed });
  },

  setTextOverlay: (overlay) => {
    // No pushUndo: TextInput fires on every keystroke, would flood undo stack
    set({ textOverlay: overlay });
  },

  pushUndo: () => {
    const { trimStart, trimEnd, subtitles, speed, textOverlay, undoStack } = get();
    const snapshot: EditorSnapshot = { trimStart, trimEnd, subtitles, speed, textOverlay };
    const newStack = [...undoStack, snapshot].slice(-MAX_UNDO_STACK);
    set({ undoStack: newStack, redoStack: [] });
  },

  undo: () => {
    const { undoStack, redoStack, trimStart, trimEnd, subtitles, speed, textOverlay } = get();
    if (undoStack.length === 0) return;

    const previous = undoStack[undoStack.length - 1];
    const currentSnapshot: EditorSnapshot = { trimStart, trimEnd, subtitles, speed, textOverlay };

    set({
      trimStart: previous.trimStart,
      trimEnd: previous.trimEnd,
      subtitles: previous.subtitles,
      speed: previous.speed,
      textOverlay: previous.textOverlay,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, currentSnapshot],
    });
  },

  redo: () => {
    const { undoStack, redoStack, trimStart, trimEnd, subtitles, speed, textOverlay } = get();
    if (redoStack.length === 0) return;

    const next = redoStack[redoStack.length - 1];
    const currentSnapshot: EditorSnapshot = { trimStart, trimEnd, subtitles, speed, textOverlay };

    set({
      trimStart: next.trimStart,
      trimEnd: next.trimEnd,
      subtitles: next.subtitles,
      speed: next.speed,
      textOverlay: next.textOverlay,
      undoStack: [...undoStack, currentSnapshot],
      redoStack: redoStack.slice(0, -1),
    });
  },
}));