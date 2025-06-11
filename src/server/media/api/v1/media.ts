import config from 'config';
import express, { Request, Response, Application } from 'express';
import multer from 'multer';
import MediaInterface from '../../interface';

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
    router.post('/:calendarId', upload.single('file'), this.uploadFile.bind(this));

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
        res.status(400).json({ error: 'No file provided' });
        return;
      }

      if (!calendarId) {
        res.status(400).json({ error: 'Calendar ID is required' });
        return;
      }

      const media = await this.mediaInterface.uploadFile(
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
      });
    }
  }
}
