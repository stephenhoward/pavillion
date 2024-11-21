import express, { Request, Response } from 'express';
import { Account } from '../../../common/model/account';
import jwt from 'jsonwebtoken';

interface User {
    id: number;
    name: string;
    email: string;
    role: string;
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
    adminOnly:  async (req: Request, res: Response, next: (err?: any) => void) => {
        if ( req.user && req.user.hasRole('admin') ) {
            next();
        }
        else {
            res.status(403).json({message: 'forbidden'});
        }
    },
    noUserOnly: async (req: express.Request, res: express.Response, next: (err?: any) => void) => {
        if ( !req.user ) {
            next();
        }
        else {
            res.status(403).json({message: 'forbidden'});
        }
    },
    loggedInOnly: async (req: express.Request, res: express.Response, next: (err?: any) => void) => {
        if ( req.user ) {
            next();
        }
        else {
            res.status(403).json({message: 'forbidden'});
        }
    },

    sendJWT: async (account: Account, res: Response) => {
        // generate a signed json web token with the contents of user object and return it in the response
        let payload = {
            exp: Math.floor(Date.now() / 1000) + (60 * expirationMinutes),
            id: account.id,
            isAdmin: await account.hasRole('admin')
        };
        let token = jwt.sign(payload, jwtSecret);
        return res.json({payload, token});
    }
}