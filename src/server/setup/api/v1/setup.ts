import express, { Request, Response, Application } from 'express';
import SetupInterface from '@/server/setup/interface';
import { validatePassword } from '@/common/validation/password';
import { isValidLanguageCode, DEFAULT_LANGUAGE_CODE } from '@/common/i18n/languages';

/**
 * API route handlers for first-run setup.
 */
export default class SetupRouteHandlers {
  private service: SetupInterface;

  constructor(setupInterface: SetupInterface) {
    this.service = setupInterface;
  }

  /**
   * Installs the setup API routes on the Express app.
   *
   * @param app - Express application
   * @param routePrefix - Prefix for all routes (e.g., '/api/v1')
   */
  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();

    router.get('/setup/status', this.getSetupStatus.bind(this));
    router.post('/setup', this.completeSetup.bind(this));

    app.use(routePrefix, router);
  }

  /**
   * GET /api/v1/setup/status
   *
   * Returns the current setup status.
   */
  async getSetupStatus(req: Request, res: Response): Promise<void> {
    try {
      const setupRequired = await this.service.isSetupModeActive();
      res.json({ setupRequired });
    }
    catch (error) {
      console.error('Error checking setup status:', error);
      res.status(500).json({ error: 'Failed to check setup status' });
    }
  }

  /**
   * POST /api/v1/setup
   *
   * Completes the initial setup by creating an admin account and saving settings.
   *
   * Request body:
   * - email: Admin account email (required)
   * - password: Admin account password (required)
   * - siteTitle: Site title (required)
   * - registrationMode: Registration mode - open, apply, invitation (required)
   * - defaultLanguage: Default UI language code (optional, defaults to 'en')
   */
  async completeSetup(req: Request, res: Response): Promise<void> {
    try {
      // Check if setup is still required
      const setupRequired = await this.service.isSetupModeActive();
      if (!setupRequired) {
        res.status(404).json({ error: 'Setup already completed', errorName: 'NotFoundError' });
        return;
      }

      const { email, password, siteTitle, registrationMode } = req.body;
      // Default to English if not provided
      const defaultLanguage = req.body.defaultLanguage || DEFAULT_LANGUAGE_CODE;

      // Validate required fields
      if (!email || !password || !siteTitle || !registrationMode) {
        res.status(400).json({ error: 'All fields are required', errorName: 'ValidationError' });
        return;
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        res.status(400).json({ error: 'Invalid email format', errorName: 'ValidationError' });
        return;
      }

      // Validate password using shared utility
      const passwordValidation = validatePassword(password);
      if (!passwordValidation.valid) {
        res.status(400).json({
          error: 'Invalid password',
          passwordErrors: passwordValidation.errors,
          errorName: 'ValidationError',
        });
        return;
      }

      // Validate registration mode
      const validModes = ['open', 'apply', 'invitation', 'closed'];
      if (!validModes.includes(registrationMode)) {
        res.status(400).json({
          error: 'Invalid registration mode',
          validModes,
          errorName: 'ValidationError',
        });
        return;
      }

      // Validate language code
      if (!isValidLanguageCode(defaultLanguage)) {
        res.status(400).json({
          error: 'Invalid language code',
          errorName: 'ValidationError',
        });
        return;
      }

      // Complete the setup
      await this.service.completeSetup(email, password, siteTitle, registrationMode, defaultLanguage);

      res.json({
        success: true,
        message: 'Setup completed successfully',
        redirectTo: '/login',
      });
    }
    catch (error) {
      console.error('Error completing setup:', error);
      res.status(500).json({ error: 'Failed to complete setup' });
    }
  }
}
