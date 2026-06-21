import { create } from 'zustand';
import type { SubtitleSegment } from '../services/api';

// ponytail: alias to the canonical server shape so local edits stay exportable
export type Subtitle = SubtitleSegment;

export type PresetType = 'tiktok' | 'reels' | 'shorts';

interface EditorState {
  trimStart: number;
  trimEnd: number;
  subtitles: Subtitle[];
  preset: PresetType;
}

interface EditorActions {
  setTrimStart: (value: number) => void;
  setTrimEnd: (value: number) => void;
  setSubtitles: (subtitles: Subtitle[]) => void;
}

type EditorStore = EditorState & EditorActions;

export const useEditorStore = create<EditorStore>((set) => ({
  trimStart: 0,
  trimEnd: 0,
  subtitles: [],
  preset: 'tiktok',

  setTrimStart: (value) => set({ trimStart: Math.max(0, value) }),
  setTrimEnd: (value) => set({ trimEnd: value }),
  setSubtitles: (subtitles) => set({ subtitles }),
}));
