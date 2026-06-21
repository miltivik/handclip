import { MAX_VIDEO_DURATION_SEC, MAX_VIDEO_SIZE_BYTES } from './constants';

interface ValidationResult {
  valid: boolean;
  error?: string;
}

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];

export function validateVideoFile(
  fileName: string,
  fileSize: number,
  duration?: number
): ValidationResult {
  // Check file extension
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) {
    return { valid: false, error: 'El archivo debe tener una extensión' };
  }
  const extension = fileName.toLowerCase().slice(dot);
  if (!VIDEO_EXTENSIONS.includes(extension)) {
    return {
      valid: false,
      error: `Formato no soportado. Formatos válidos: ${VIDEO_EXTENSIONS.join(', ')}`,
    };
  }

  // Check file size
  if (fileSize > MAX_VIDEO_SIZE_BYTES) {
    const maxSizeGB = (MAX_VIDEO_SIZE_BYTES / (1024 * 1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `El archivo es demasiado grande. Máximo: ${maxSizeGB} GB`,
    };
  }

  // Check duration if provided
  if (duration !== undefined && duration > MAX_VIDEO_DURATION_SEC) {
    const maxDurationMin = Math.floor(MAX_VIDEO_DURATION_SEC / 60);
    return {
      valid: false,
      error: `El video es demasiado largo. Máximo: ${maxDurationMin} minutos`,
    };
  }

  return { valid: true };
}
