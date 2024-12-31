import express, { Application, Router } from 'express';
import passport from 'passport';
import passportJWT from 'passport-jwt';
import { Strategy as LocalStrategy } from 'passport-local';

import { Account } from '@/common/model/account';
import CommonAccountService from '@/server/common/service/accounts';
import { router as AuthRoutes} from '@/server/authentication/api/v1/auth';
import AuthenticationService from '@/server/authentication/service/auth';

const jwtSecret = 'secret';  // TODO: add secret here

const apiV1 = (app: Application) => {

    passport.use(new LocalStrategy({
        usernameField: 'email',
        passwordField: 'password'
    },
    async function(email: string, password: string, done: (error: any, user?: Account | boolean, info?: any) => void) {
        let account = await CommonAccountService.getAccountByEmail(email);

        if ( account ) {
            let passwordMatch = await AuthenticationService.checkPassword(account, password);

            if ( passwordMatch ) {
                return done(null, account);
            }
        }

        return done(null, false, { message: 'Incorrect email or password.' });
    }));

    passport.use(new passportJWT.Strategy({
        jwtFromRequest: passportJWT.ExtractJwt.fromAuthHeaderAsBearerToken(),
        secretOrKey: jwtSecret
    }, async (jwtPayload, done) => {

        const account = await CommonAccountService.getAccountById(jwtPayload.id);

        if ( !account ) {
            return done(null, false, { message: 'Incorrect email or password.' });
        }

        return done(null, account);
    }));

    const router = Router();
    app.use(express.json());
    app.use('/api/auth/v1', AuthRoutes);
};

export default apiV1;