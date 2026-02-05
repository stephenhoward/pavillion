import config from 'config';
import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import passport from 'passport';

import { Account } from '@/common/model/account';

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

// UUID v4 validation regex
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default {
  /**
   * Validates if a string is a valid UUID v4
   */
  isValidUUID(uuid: string): boolean {
    return typeof uuid === 'string' && UUID_V4_REGEX.test(uuid);
  },

  /**
   * Validates an array of UUIDs and returns an array of invalid ones
   */
  findInvalidUUIDs(uuids: string[]): string[] {
    return uuids.filter(uuid => !this.isValidUUID(uuid));
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
