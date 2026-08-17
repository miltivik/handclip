import { Controller, Get, Header, NotFoundException, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../decorators/public.decorator';
import { ProjectsService, PublicShareView } from './projects.service';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function renderShareHtml(view: PublicShareView): string {
  const clipCards = view.clips
    .map(
      (clip) => `
        <article class="clip">
          <div class="clip-head">
            <span class="score">${clip.confidenceScore}</span>
            <span class="time">${formatTime(clip.startTime)} → ${formatTime(clip.endTime)}</span>
          </div>
          ${clip.suggestedCaption ? `<p class="caption">“${escapeHtml(clip.suggestedCaption)}”</p>` : ''}
          ${clip.transcriptSnippet ? `<p class="snippet">${escapeHtml(clip.transcriptSnippet)}</p>` : ''}
          ${clip.moodTags.length ? `<p class="tags">${clip.moodTags.map((t) => `<span>#${escapeHtml(t)}</span>`).join(' ')}</p>` : ''}
        </article>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(view.title)} — HandClip</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; font-family:system-ui,-apple-system,sans-serif; background:#0f1115; color:#e8e8ea; }
  .wrap { max-width:640px; margin:0 auto; padding:32px 16px 48px; }
  h1 { font-size:24px; margin:0 0 4px; }
  .meta { color:#8a8f98; font-size:14px; margin-bottom:24px; }
  .badge { display:inline-block; background:#1c2333; color:#7ab7ff; border-radius:999px; padding:2px 10px; font-size:12px; margin-right:8px; }
  .clip { background:#171a21; border:1px solid #262b36; border-radius:14px; padding:16px; margin-bottom:12px; }
  .clip-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
  .score { background:#0e3a1f; color:#4ade80; font-weight:700; border-radius:8px; padding:2px 10px; }
  .time { color:#8a8f98; font-size:13px; }
  .caption { font-size:16px; margin:6px 0; }
  .snippet { color:#a8adb8; font-size:14px; margin:6px 0; }
  .tags span { color:#7ab7ff; font-size:13px; margin-right:8px; }
  footer { color:#5b616c; font-size:12px; text-align:center; margin-top:32px; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>${escapeHtml(view.title)}</h1>
    <p class="meta">
      <span class="badge">${view.clips.length} clips candidatos</span>
      <span class="badge">Vista de solo lectura</span>
    </p>
    ${clipCards || '<p class="snippet">Este proyecto todavía no tiene clips candidatos.</p>'}
    <footer>Compartido con HandClip</footer>
  </div>
</body>
</html>`;
}

/**
 * Anonymous read-only share viewer. Tokens are unguessable (24 random
 * bytes, base64url); revoked/expired tokens resolve to 404 without
 * revealing whether the project exists. Browsers (Accept: text/html) get
 * a minimal HTML page; API clients get JSON.
 */
@Controller('public')
export class PublicSharesController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Public()
  @Get('shares/:token')
  @Header('Cache-Control', 'no-store')
  async getShareView(
    @Param('token') token: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const view = await this.projectsService.getPublicShareView(token);
    if (!view) {
      throw new NotFoundException('Enlace no disponible');
    }

    const accept = String(req.headers['accept'] ?? '');
    if (accept.includes('text/html')) {
      res.type('text/html').send(renderShareHtml(view));
      return;
    }
    return view;
  }
}
