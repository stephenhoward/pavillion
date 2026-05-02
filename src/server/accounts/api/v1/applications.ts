import express, { Request, Response } from 'express';
import ExpressHelper from '@/server/common/helper/express';
import AccountsInterface from '@/server/accounts/interface';
import {
  AccountAlreadyExistsError,
  AccountApplicationAlreadyExistsError,
  AccountApplicationsClosedError,
} from '@/server/accounts/exceptions';
import { ValidationError } from '@/common/exceptions/base';
import { logError } from '@/server/common/helper/error-logger';
import { createLogger } from '@/server/common/helper/logger';
import {
  applicationByEmail,
  applicationByIp,
  confirmApplicationByIp,
} from '@/server/common/middleware/rate-limiters';

const logger = createLogger('accounts');

export default class AccountApplicationRouteHandlers {
  private service: AccountsInterface;

  constructor(service: AccountsInterface) {
    this.service = service;
  }

  installHandlers(app: express.Application, routePrefix: string): void {
    const router = express.Router();
    // Rate limit POST /applications by IP (anti-spam) and by email (anti-
    // enumeration probing). Both limiters are pre-configured singletons in
    // rate-limiters.ts (epic pv-l9wv); they fall back to no-op middleware
    // when rate limiting is disabled in config.
    router.post(
      '/applications',
      applicationByIp,
      applicationByEmail,
      ...ExpressHelper.noUserOnly,
      this.applyToRegister.bind(this),
    );
    // CRITICAL: confirm routes are registered BEFORE `/applications/:id` so the
    // static `confirm` segment is not matched as an `:id` parameter (Express
    // matches in registration order).
    // These endpoints are anonymous: the URL-path token IS the bearer
    // credential, so no session middleware and no CSRF token are applied —
    // either would break the email-link flow.
    router.get('/applications/confirm/:token', confirmApplicationByIp, this.checkConfirmationToken.bind(this));
    router.post('/applications/confirm/:token', confirmApplicationByIp, this.consumeConfirmationToken.bind(this));
    router.get('/applications', ...ExpressHelper.adminOnly, this.listApplications.bind(this));
    router.post('/applications/:id', ...ExpressHelper.adminOnly, this.processApplication.bind(this));
    app.use(routePrefix, router);
  }

  async applyToRegister(req: Request, res: Response) {
    try {
      await this.service.applyForNewAccount(req.body.email, req.body.message);
    }
    catch (error) {
      if (error instanceof ValidationError) {
        // Safe to reveal: format errors don't indicate account existence (validation runs before DB queries)
        ExpressHelper.sendValidationError(res, error);
        return;
      }
      else if (error instanceof AccountAlreadyExistsError) {
        // Defensive: the service no longer throws this on the apply path
        // (pv-l9wv.3.1 makes existing-account submissions silently swallow it
        // for anti-enumeration timing). Kept as a defense-in-depth catch so a
        // future service-layer regression cannot leak account existence to
        // the caller. Log without the email field — it is PII and is not
        // needed to investigate this branch (see pv-l9wv logging hygiene).
        logger.info('Application attempted for existing account');
      }
      else if (error instanceof AccountApplicationAlreadyExistsError) {
        // Defensive: the service no longer throws this on the apply path
        // (pv-l9wv.3.1 makes duplicate submissions silently swallow it). Kept
        // as a defense-in-depth catch so a future service-layer regression
        // cannot leak application existence to the caller. Log without the
        // email field — it is PII and is not needed to investigate this
        // branch (see pv-l9wv logging hygiene).
        logger.info('Duplicate application attempted');
      }
      else if (error instanceof AccountApplicationsClosedError) {
        // This is a system state error, not an enumeration risk, so reveal it
        res.status(400).json({ error: 'account_applications_closed', errorName: 'AccountApplicationsClosedError' });
        return;
      }
      else {
        // Unexpected error - log and return generic error
        logError(error, 'Error processing application');
        res.status(500).json({ error: 'application_processing_error', errorName: 'ApplicationProcessingError' });
        return;
      }
    }
    // Always return success response to prevent account enumeration
    res.json({ success: true, message: 'application_submitted' });
  }

  /**
   * GET /api/v1/applications/confirm/:token
   * Anonymous endpoint that reports whether a confirmation token is currently
   * valid. The URL-path token is the bearer credential — no session, no CSRF.
   * All terminal failure states (token not found, expired, already-consumed,
   * wrong status) collapse to the same `{ valid: false }` response so an
   * enumerator cannot distinguish them (anti-enumeration; epic pv-l9wv).
   * HTTP status is always 200 to keep the same shape for valid and invalid
   * tokens. Tokens are never logged.
   */
  async checkConfirmationToken(req: Request, res: Response) {
    try {
      const valid = await this.service.validateConfirmationToken(req.params.token);
      res.json({ valid: !!valid });
    }
    catch (error) {
      // Anti-enumeration: a transient infrastructure failure must not produce
      // a distinguishable HTTP 500. Collapse to the standard failure shape so
      // not-found / expired / already-consumed / DB-error are indistinguishable
      // to a caller (epic pv-l9wv). Token value is never included in the log.
      logError(error, 'Error checking confirmation token');
      res.json({ valid: false });
    }
  }

  /**
   * POST /api/v1/applications/confirm/:token
   * Anonymous endpoint that atomically consumes a confirmation token,
   * transitioning the matching application from `pending_confirmation` to
   * `pending`. Same anti-enumeration posture as the GET counterpart: every
   * terminal failure state collapses to `{ valid: false }` (HTTP 200) so a
   * caller cannot distinguish "not found" from "expired" from
   * "already-consumed" from "wrong status". On success, returns
   * `{ success: true }`. Tokens are never logged.
   */
  async consumeConfirmationToken(req: Request, res: Response) {
    try {
      const success = await this.service.confirmAccountApplication(req.params.token);
      if (success) {
        res.json({ success: true });
      }
      else {
        // Identical failure shape to GET so the two endpoints are
        // indistinguishable in any terminal failure state.
        res.json({ valid: false });
      }
    }
    catch (error) {
      // Anti-enumeration: see checkConfirmationToken — same rationale.
      logError(error, 'Error consuming confirmation token');
      res.json({ valid: false });
    }
  }

  /**
   * GET /api/v1/applications
   * Admin list of account applications. Accepts an optional `status` query
   * param: `pending_confirmation`, `pending`, or `rejected`. When omitted (or
   * given an unrecognized value), the response excludes `pending_confirmation`
   * rows so the queue surfaces only actionable applications. The service-layer
   * filter enforces the allow-list; see `listAccountApplications` for details.
   */
  async listApplications(req: Request, res: Response) {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const status = req.query.status as string | undefined;

    const result = await this.service.listAccountApplications(page, limit, status);

    res.json({
      applications: result.applications,
      pagination: result.pagination,
    });
  }

  async processApplication(req: Request, res: Response) {
    try {
      if (req.body.accepted === true) {
        const account = await this.service.acceptAccountApplication(req.params.id);
        res.json({ success: true, message: 'application_accepted', account });
      }
      else if (req.body.accepted === false) {
        await this.service.rejectAccountApplication(req.params.id, req.body.silent === true);
        res.json({ success: true, message: 'application_rejected' });
      }
      else {
        res.status(400).json({ error: 'invalid_request', errorName: 'ValidationError' });
      }
    }
    catch (error) {
      // Don't expose internal error details - use generic translation key
      logError(error, 'Error processing application');
      res.status(400).json({ error: 'application_processing_error', errorName: 'ApplicationProcessingError' });
    }
  }
}
