import config from 'config';
import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import passport from 'passport';

import { Account } from '@/common/model/account';
import { ValidationError } from '@/common/exceptions/base';
import { isValidUuidV4 } from '@/server/common/helper/uuid';

interface User {
  id: string;
  email: string;
  roles: string[] | null;
  hasRole(role: string): boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
  }
}

const jwtSecret = config.get<string>('jwt.secret');
const expirationMinutes = 5;

export default {
  /**
   * Validates if a value is a valid UUID v4
   *
   * Takes `unknown` and narrows to `string` so it can guard route parameters,
   * which Express types as `string | string[]`.
   */
  isValidUUID(uuid: unknown): uuid is string {
    return isValidUuidV4(uuid);
  },

  /**
   * Validates an array of UUIDs and returns an array of invalid ones
   */
  findInvalidUUIDs(uuids: string[]): string[] {
    return uuids.filter(uuid => !this.isValidUUID(uuid));
  },

  /**
   * Sends a standardized validation error response
   *
   * @param res - Express response object
   * @param error - ValidationError instance or subclass
   */
  sendValidationError(res: Response, error: ValidationError): void {
    const responseBody: {
      error: string;
      errorName: string;
      fields?: Record<string, string[]>;
    } = {
      error: error.message,
      errorName: error.name,
    };

    // Include fields if present
    if (error.fields) {
      responseBody.fields = error.fields;
    }

    res.status(400).json(responseBody);
  },

  adminOnly: [
    passport.authenticate('jwt', {session: false}),
    async (req: Request, res: Response, next: (err?: any) => void) => {
      if ( req.user && req.user.hasRole('admin') ) {
        next();
      }
      else {
        res.status(403).json({message: 'forbidden'});
      }
    },
  ],
  noUserOnly: [
    async (req: express.Request, res: express.Response, next: (err?: any) => void) => {
      if ( !req.user ) {
        next();
      }
      else {
        res.status(403).json({message: 'forbidden'});
      }
    },
  ],
  loggedInOnly: [
    passport.authenticate('jwt', {session: false}),
    async (req: express.Request, res: express.Response, next: (err?: any) => void) => {
      if ( req.user ) {
        next();
      }
      else {
        res.status(403).json({message: 'forbidden'});
      }
    },
  ],
  generateJWT: (account: Account): string => {
    // generate a signed json web token with the contents of user object and return it in the response
    let payload = {
      exp: Math.floor(Date.now() / 1000) + (60 * expirationMinutes),
      id: account.id,
      email: account.email,
      isAdmin: account.hasRole('admin'),
    };
    let token = jwt.sign(payload, jwtSecret);
    return token;
  },
};
