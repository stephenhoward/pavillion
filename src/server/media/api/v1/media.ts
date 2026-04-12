import config from 'config';
import express, { Request, Response, Application } from 'express';
import multer from 'multer';
import ExpressHelper from '@/server/common/helper/express';
import MediaInterface from '../../interface';
import { Account } from '@/common/model/account';
import { CalendarNotFoundError, InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';
import {
  MediaNotApprovedError,
  MediaNotFoundError,
  MediaFileTooLargeError,
  MediaInvalidTypeError,
  MediaStorageError,
} from '@/common/exceptions/media';
import { logError } from '@/server/common/helper/error-logger';

// Extend Express Request interface to include file property
declare global {
  namespace Express {
    interface Request {
      file?: Express.Multer.File;
    }
  }
}

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.get('media.maxFileSize') || 10 * 1024 * 1024, // Default to 10MB
  },
});

export default class MediaRoutes {
  private mediaInterface: MediaInterface;

  constructor(mediaInterface: MediaInterface) {
    this.mediaInterface = mediaInterface;
  }

  /**
   * Install all media route handlers
   */
  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();

    // File upload endpoint
    router.post('/:calendarId', ...ExpressHelper.loggedInOnly, upload.single('file'), this.uploadFile.bind(this));

    // File serve endpoint
    router.get('/:mediaId', this.serveFile.bind(this));

    app.use(routePrefix, router);
  }

  /**
   * Upload a file to a calendar
   */
  async uploadFile(req: Request, res: Response): Promise<void> {
    try {
      const { calendarId } = req.params;
      const { eventId } = req.body;
      const file = req.file;

      if (!file) {
        res.status(400).json({ error: 'Invalid request', errorName: 'ValidationError' });
        return;
      }

      if (!calendarId || !ExpressHelper.isValidUUID(calendarId)) {
        res.status(400).json({ error: 'Invalid request', errorName: 'ValidationError' });
        return;
      }

      const media = await this.mediaInterface.uploadFile(
        req.user as Account,
        calendarId,
        file.buffer,
        file.originalname,
        file.mimetype,
        eventId,
      );

      res.status(201).json({
        message: 'File uploaded successfully',
        media: media.toObject(),
      });
    }
    catch (error) {
      if (error instanceof MediaFileTooLargeError) {
        res.status(400).json({ error: 'File is too large', errorName: 'MediaFileTooLargeError' });
        return;
      }
      if (error instanceof MediaInvalidTypeError) {
        res.status(400).json({ error: 'File type is not supported', errorName: 'MediaInvalidTypeError' });
        return;
      }
      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ error: 'Calendar not found', errorName: 'CalendarNotFoundError' });
        return;
      }
      if (error instanceof InsufficientCalendarPermissionsError) {
        res.status(403).json({ error: 'You do not have permission to upload to this calendar', errorName: 'InsufficientCalendarPermissionsError' });
        return;
      }
      if (error instanceof MediaStorageError) {
        logError(error, 'File upload storage error');
        res.status(500).json({ error: 'Unable to store file', errorName: 'MediaStorageError' });
        return;
      }

      logError(error, 'File upload error');
      res.status(500).json({ error: 'An unexpected error occurred', errorName: 'UnknownError' });
    }
  }

  /**
   * Serve a media file by ID
   */
  async serveFile(req: Request, res: Response): Promise<void> {
    try {
      const { mediaId } = req.params;

      if (!mediaId || !ExpressHelper.isValidUUID(mediaId)) {
        res.status(400).json({ error: 'Invalid request', errorName: 'ValidationError' });
        return;
      }

      const fileData = await this.mediaInterface.getFile(mediaId);

      if (!fileData) {
        res.status(404).json({ error: 'Media not found', errorName: 'MediaNotFoundError' });
        return;
      }

      // Set appropriate headers
      res.set({
        'Content-Type': fileData.media.mimeType,
        'Content-Length': fileData.media.fileSize.toString(),
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
        'ETag': fileData.media.sha256,
        'X-Content-Type-Options': 'nosniff',
      });

      // Send the file buffer
      res.send(fileData.buffer);
    }
    catch (error) {
      if (error instanceof MediaNotApprovedError) {
        res.status(202).json({
          error: 'Media is still being processed',
          errorName: 'MediaNotApprovedError',
          status: error.status,
        });
        return;
      }

      if (error instanceof MediaNotFoundError) {
        res.status(404).json({ error: 'Media not found', errorName: 'MediaNotFoundError' });
        return;
      }

      logError(error, 'File serve error');
      res.status(500).json({ error: 'An unexpected error occurred', errorName: 'UnknownError' });
    }
  }
}
