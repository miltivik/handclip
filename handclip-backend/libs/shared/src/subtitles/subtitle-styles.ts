/**
 * Premium subtitle style catalog.
 *
 * Each preset maps to ASS (Advanced SubStation) style parameters that the
 * worker burns in via FFmpeg/libass. 'classic' keeps the legacy
 * SRT + force_style path and is the default for backward compatibility;
 * every other id renders as an animated ASS track (karaoke highlight,
 * pop-in, fade) built from Whisper word-level timestamps when available.
 */
import { z } from 'zod';

export const SUBTITLE_STYLE_IDS = [
  'classic',
  'karaoke-pop',
  'bold-impact',
  'neon-outline',
  'minimal-fade',
] as const;

export const SubtitleStyleIdSchema = z.enum(SUBTITLE_STYLE_IDS);

export type SubtitleStyleId = (typeof SUBTITLE_STYLE_IDS)[number];

export type SubtitleAnimation = 'none' | 'karaoke' | 'pop' | 'fade';

export interface SubtitleStylePreset {
  id: SubtitleStyleId;
  /** Display name (es). */
  name: string;
  /** Short description for the picker (es). */
  description: string;
  animation: SubtitleAnimation;
  /** ASS colors use &HAABBGGRR (alpha, blue, green, red). */
  fontName: string;
  fontSize: number;
  primaryColour: string;
  /** Karaoke pre-highlight color (used while a word is not spoken yet). */
  secondaryColour: string;
  outlineColour: string;
  backColour: string;
  bold: boolean;
  outline: number;
  shadow: number;
  /** Bottom margin in PlayRes pixels (1080x1920). */
  marginV: number;
  uppercase: boolean;
}

export const SUBTITLE_STYLE_PRESETS: Record<SubtitleStyleId, SubtitleStylePreset> = {
  classic: {
    id: 'classic',
    name: 'Clásico',
    description: 'Blanco con borde negro, sin animación.',
    animation: 'none',
    fontName: 'Arial',
    fontSize: 64,
    primaryColour: '&H00FFFFFF',
    secondaryColour: '&H00FFFFFF',
    outlineColour: '&H00000000',
    backColour: '&H80000000',
    bold: false,
    outline: 3,
    shadow: 1,
    marginV: 120,
    uppercase: false,
  },
  'karaoke-pop': {
    id: 'karaoke-pop',
    name: 'Karaoke Pop',
    description: 'Mayúsculas con palabra hablada resaltada en amarillo.',
    animation: 'karaoke',
    fontName: 'Arial Black',
    fontSize: 84,
    primaryColour: '&H0000E5FF', // yellow
    secondaryColour: '&H00F0F0F0', // light gray
    outlineColour: '&H00000000',
    backColour: '&H80000000',
    bold: true,
    outline: 5,
    shadow: 2,
    marginV: 140,
    uppercase: true,
  },
  'bold-impact': {
    id: 'bold-impact',
    name: 'Impacto',
    description: 'Letras gigantes con borde grueso y entrada pop.',
    animation: 'pop',
    fontName: 'Impact',
    fontSize: 96,
    primaryColour: '&H00FFFFFF',
    secondaryColour: '&H00FFFFFF',
    outlineColour: '&H00000000',
    backColour: '&H80000000',
    bold: true,
    outline: 7,
    shadow: 0,
    marginV: 160,
    uppercase: true,
  },
  'neon-outline': {
    id: 'neon-outline',
    name: 'Neón',
    description: 'Cian brillante con doble contorno estilo neón.',
    animation: 'pop',
    fontName: 'Arial',
    fontSize: 80,
    primaryColour: '&H00F5FF00', // cyan
    secondaryColour: '&H00F5FF00',
    outlineColour: '&H00801040', // dark red-pink outer glow
    backColour: '&H80000000',
    bold: true,
    outline: 6,
    shadow: 3,
    marginV: 140,
    uppercase: false,
  },
  'minimal-fade': {
    id: 'minimal-fade',
    name: 'Minimal',
    description: 'Discreto y elegante, con fundido de entrada y salida.',
    animation: 'fade',
    fontName: 'Helvetica',
    fontSize: 58,
    primaryColour: '&H00FFFFFF',
    secondaryColour: '&H00FFFFFF',
    outlineColour: '&H00202020',
    backColour: '&H60000000',
    bold: false,
    outline: 2,
    shadow: 0,
    marginV: 110,
    uppercase: false,
  },
};

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyleId = 'classic';

export function isValidSubtitleStyleId(value: unknown): value is SubtitleStyleId {
  return typeof value === 'string' && (SUBTITLE_STYLE_IDS as readonly string[]).includes(value);
}

export function resolveSubtitleStyle(value: unknown): SubtitleStyleId {
  return isValidSubtitleStyleId(value) ? value : DEFAULT_SUBTITLE_STYLE;
}

export function isPremiumSubtitleStyle(value: unknown): boolean {
  return isValidSubtitleStyleId(value) && value !== 'classic';
}
