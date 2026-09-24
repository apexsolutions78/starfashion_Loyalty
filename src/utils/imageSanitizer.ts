import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { createAppError } from '../middleware/errorHandler';

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png']);

/**
 * Re-encode an uploaded JPEG/PNG through sharp to strip EXIF/metadata and
 * normalize the file. PDFs (and anything unexpected) pass through untouched.
 * On failure the file is removed and INVALID_IMAGE is thrown.
 */
export async function sanitizeUploadedImage(filePath: string, mimetype: string): Promise<void> {
  const ext = path.extname(filePath).toLowerCase();
  if (!IMAGE_MIMES.has(mimetype) || !IMAGE_EXTS.has(ext)) {
    return;
  }

  const tmpPath = `${filePath}.tmp`;
  try {
    const pipeline = sharp(filePath, { failOn: 'none', limitInputPixels: 40_000_000 });

    if (mimetype === 'image/png' || ext === '.png') {
      await pipeline.png({ compressionLevel: 9 }).toFile(tmpPath);
    } else {
      await pipeline.jpeg({ quality: 85, mozjpeg: true }).toFile(tmpPath);
    }

    await fs.rename(tmpPath, filePath);
  } catch {
    await fs.unlink(tmpPath).catch(() => undefined);
    await fs.unlink(filePath).catch(() => undefined);
    throw createAppError('Invalid or corrupt image file', 400, 'INVALID_IMAGE');
  }
}
