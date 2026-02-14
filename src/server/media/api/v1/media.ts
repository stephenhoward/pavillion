import config from 'config';
import express, { Request, Response, Application } from 'express';
import multer from 'multer';
import ExpressHelper from '@/server/common/helper/express';
import MediaInterface from '../../interface';
import { Account } from '@/common/model/account';
import { MediaNotApprovedError, MediaNotFoundError } from '@/common/exceptions/media';

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

export default class MediaRouteHandlers {
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
        res.status(400).json({ error: 'No file provided', errorName: 'ValidationError' });
        return;
      }

      if (!calendarId) {
        res.status(400).json({ error: 'Calendar ID is required', errorName: 'ValidationError' });
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
      console.error('File upload error:', error);
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Upload failed',
        errorName: 'ValidationError',
      });
    }
  }

  /**
   * Serve a media file by ID
   */
  async serveFile(req: Request, res: Response): Promise<void> {
    try {
      const { mediaId } = req.params;

      if (!mediaId) {
        res.status(400).json({ error: 'Media ID is required', errorName: 'ValidationError' });
        return;
      }

      const fileData = await this.mediaInterface.getFile(mediaId);

      if (!fileData) {
        res.status(404).json({ error: 'Media not found', errorName: 'MediaNotFoundError' });
        return;
      }

      // Set appropriate headers
      res.set({
        'Mime-Type': fileData.media.mimeType,
        'Content-Type': fileData.media.mimeType,
        'Content-Length': fileData.media.fileSize.toString(),
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
        'ETag': fileData.media.sha256,
      });

      // Send the file buffer
      res.send(fileData.buffer);
    }
    catch (error) {
      if (error instanceof MediaNotApprovedError) {
        // Return 202 Accepted to indicate media is still being processed
        res.status(202).json({
          error: 'Media is still being processed',
          status: error.status,
          mediaId: error.mediaId,
        });
        return;
      }

      if (error instanceof MediaNotFoundError) {
        res.status(404).json({
          error: error.message,
          mediaId: error.mediaId,
          errorName: 'NotFoundError',
        });
        return;
      }

      console.error('File serve error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to serve file',
      });
    }
  }
}
