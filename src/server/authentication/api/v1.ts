import express, { Application, Router } from 'express';
import AuthRoutes from './v1/auth';
import passport from 'passport';
import { Account } from '../../../common/model/account';
import { Strategy as LocalStrategy } from 'passport-local';
import passportJWT from 'passport-jwt';
import AccountService from '../service/account';
import CommonAccountService from '../../common/service/accounts';

const jwtSecret = 'secret';  // TODO: add secret here

const apiV1 = (app: Application) => {

    passport.use(new LocalStrategy({
        usernameField: 'email',
        passwordField: 'password'
    },
    async function(email: string, password: string, done: (error: any, user?: Account | boolean, info?: any) => void) {
        let account = await CommonAccountService.getAccountByEmail(email);

        if ( account ) {
            let passwordMatch = await AccountService.checkPassword(account, password);

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