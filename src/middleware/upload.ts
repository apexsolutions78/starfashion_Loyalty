import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { env } from '../config';
import { createAppError } from './errorHandler';

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'application/pdf'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.pdf'];
const MIME_TO_EXT: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'application/pdf': ['.pdf'],
};
const MAX_FILE_SIZE = env.MAX_UPLOAD_MB * 1024 * 1024;

const uploadDir = path.resolve(env.UPLOAD_DIR);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ALLOWED_EXTENSIONS.includes(ext) ? ext : '';
    const safeName = `${randomUUID()}${safeExt}`;
    cb(null, safeName);
  },
});

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeOk = ALLOWED_MIMES.includes(file.mimetype);
  const extOk = ALLOWED_EXTENSIONS.includes(ext);
  const extMatchesMime = !extOk || (MIME_TO_EXT[file.mimetype] || []).includes(ext);

  if (mimeOk && extOk && extMatchesMime) {
    cb(null, true);
  } else {
    cb(createAppError('Only JPEG, PNG, and PDF files are allowed', 400, 'INVALID_FILE_TYPE'));
  }
};

export const uploadReceipt = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
}).single('receiptImage');

export function handleUploadError(err: Error, _req: Request, res: Response, next: NextFunction): void {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(createAppError(`File too large. Maximum size is ${env.MAX_UPLOAD_MB}MB`, 400, 'FILE_TOO_LARGE'));
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return next(createAppError('Only one file allowed per upload', 400, 'TOO_MANY_FILES'));
    }
    return next(createAppError('Upload error', 400, 'UPLOAD_ERROR'));
  }
  next(err);
}
