/**
 * Mobile mirror of the backend subtitle style catalog
 * (handclip-backend/libs/shared/src/subtitles/subtitle-styles.ts).
 * Keep ids in sync: the export API validates them server-side.
 */
export type SubtitleStyleId =
  | 'classic'
  | 'karaoke-pop'
  | 'bold-impact'
  | 'neon-outline'
  | 'minimal-fade';

export interface SubtitleStyleOption {
  id: SubtitleStyleId;
  label: string;
  description: string;
  /** Chip preview colors (CSS-ish hex). */
  color: string;
  outline: string;
  uppercase: boolean;
}

export const SUBTITLE_STYLES: SubtitleStyleOption[] = [
  {
    id: 'classic',
    label: 'Clásico',
    description: 'Blanco con borde negro',
    color: '#FFFFFF',
    outline: '#000000',
    uppercase: false,
  },
  {
    id: 'karaoke-pop',
    label: 'Karaoke',
    description: 'Palabra hablada en amarillo',
    color: '#FFE500',
    outline: '#000000',
    uppercase: true,
  },
  {
    id: 'bold-impact',
    label: 'Impacto',
    description: 'Gigante con entrada pop',
    color: '#FFFFFF',
    outline: '#000000',
    uppercase: true,
  },
  {
    id: 'neon-outline',
    label: 'Neón',
    description: 'Cian con contorno brillante',
    color: '#00FFF5',
    outline: '#401080',
    uppercase: false,
  },
  {
    id: 'minimal-fade',
    label: 'Minimal',
    description: 'Discreto con fundido',
    color: '#FFFFFF',
    outline: '#202020',
    uppercase: false,
  },
];

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyleId = 'classic';
