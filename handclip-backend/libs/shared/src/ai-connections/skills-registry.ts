/**
 * Internal Creative Skills for HandClip.
 *
 * These are NOT user-facing or installable. They encode domain knowledge
 * that the worker injects into LLM prompts to produce better short-form
 * video edits. Each skill is a compact set of rules activated by task type.
 */

export type CreativeSkillId =
  | 'handclip-short-form-editor'
  | 'handclip-caption-style'
  | 'handclip-remotion-render'
  | 'handclip-viral-pacing'
  | 'handclip-brand-safe-video'
  | 'handclip-audio-sync';

export type TaskStage = 'transcription' | 'clip-analysis' | 'captions' | 'broll' | 'edit-prompt' | 'render-plan';

export interface CreativeSkill {
  id: CreativeSkillId;
  /** Short human-readable description. */
  description: string;
  /** Which task stages this skill applies to. */
  stages: TaskStage[];
  /** Compact rule set to inject into the system prompt. */
  rules: string;
}

const SKILLS: readonly CreativeSkill[] = [
  {
    id: 'handclip-short-form-editor',
    description: 'Pacing, hooks, cuts, and structure for short-form video.',
    stages: ['clip-analysis', 'edit-prompt'],
    rules: [
      'OPEN with a hook in the first 1-2 seconds: visual surprise, question, or bold statement.',
      'CUT every 2-4 seconds to maintain rhythm. No static shots longer than 5s.',
      'FRONT-LOAD the most engaging moment. Do not save the best for last.',
      'KEEP total duration under 60s for TikTok/Reels, 90s for Shorts.',
      'END with a clear CTA or loop-back moment that encourages replay.',
    ].join('\n'),
  },
  {
    id: 'handclip-caption-style',
    description: 'Caption formatting, safe areas, and readability rules.',
    stages: ['captions', 'render-plan'],
    rules: [
      'MAX 8 words per caption line. Break at natural phrase boundaries.',
      'POSITION captions in the lower-center safe area (bottom 25% of frame).',
      'USE high-contrast text: white with black outline or dark background bar.',
      'HIGHLIGHT key words with color or size emphasis (max 1-2 words per caption).',
      'AVOID captions overlapping with platform UI elements (buttons, progress bar).',
      'FONT SIZE: at least 5% of frame height for readability on mobile.',
    ].join('\n'),
  },
  {
    id: 'handclip-remotion-render',
    description: 'Remotion rendering rules, transitions, and asset handling.',
    stages: ['render-plan', 'edit-prompt'],
    rules: [
      'USE Remotion composition dimensions matching the target preset (1080x1920 for vertical).',
      'TRANSITIONS: prefer cut or fast fade (0.15s). Avoid wipes and complex transitions.',
      'TIMING: all frame calculations must use Remotion fps (30 or 60).',
      'ASSETS: use static imports or URLs. No dynamic require() in Remotion components.',
      'SPRING animations for emphasis. Linear timing for captions.',
    ].join('\n'),
  },
  {
    id: 'handclip-viral-pacing',
    description: 'Rhythm and beat-matching for viral short-form content.',
    stages: ['clip-analysis', 'edit-prompt'],
    rules: [
      'SYNC cuts to audio beats when music is present.',
      'VARY pacing: alternate fast-cut sequences (0.5-1s) with brief holds (2-3s).',
      'USE pattern interrupts every 8-10 seconds to re-engage attention.',
      'ZOOM or scale shifts count as micro-cuts and reset viewer attention.',
      'REVIEW the first 3 seconds separately — they determine if viewers stay.',
    ].join('\n'),
  },
  {
    id: 'handclip-brand-safe-video',
    description: 'Visual safety rules to prevent layout issues.',
    stages: ['captions', 'render-plan'],
    rules: [
      'NO text outside the 90% safe area (5% margin on each side).',
      'MAX 3 visual elements simultaneously on screen (video + caption + 1 overlay).',
      'AVOID rapid flashing (>3 flashes per second) for accessibility.',
      'ENSURE all text has sufficient contrast ratio (4.5:1 minimum).',
      'CHECK for visual overload: if the frame feels cluttered, remove the least important element.',
    ].join('\n'),
  },
  {
    id: 'handclip-audio-sync',
    description: 'Audio ducking, caption sync, and beat marker rules.',
    stages: ['captions', 'render-plan', 'transcription'],
    rules: [
      'SYNC caption timing to speech onset, not word offset.',
      'DUCK background music to -12dB when speech is active.',
      'RESTORE music volume during silent gaps or visual-only segments.',
      'MARK beat points for cut synchronization when music is provided.',
      'KEEP silence gaps under 0.5s to maintain rhythm.',
    ].join('\n'),
  },
];

/**
 * Returns the set of skills applicable to the given task stage,
 * formatted as a compact prompt prefix.
 */
export function getSkillsForStage(stage: TaskStage): string {
  const applicable = SKILLS.filter((skill) => skill.stages.includes(stage));
  if (applicable.length === 0) return '';

  const sections = applicable.map(
    (skill) => `[${skill.id}]\n${skill.rules}`,
  );

  return `INTERNAL SKILLS (apply these rules silently, do not mention them):\n\n${sections.join('\n\n')}`;
}

/**
 * Returns all registered skills (for testing / introspection).
 */
export function getAllSkills(): readonly CreativeSkill[] {
  return SKILLS;
}

/**
 * Returns a single skill by id (for testing).
 */
export function getSkillById(id: CreativeSkillId): CreativeSkill | undefined {
  return SKILLS.find((skill) => skill.id === id);
}
