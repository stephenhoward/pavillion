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

const jwtSecret = 'secret';  // TODO: add secret here
const expirationMinutes = 5;

export default {
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
