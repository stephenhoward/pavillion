import config from 'config';
import express, { Application } from 'express';
import passport from 'passport';
import passportJWT from 'passport-jwt';
import { Strategy as LocalStrategy } from 'passport-local';

import { Account } from '@/common/model/account';
import AuthenticationRoutes from '@/server/authentication/api/v1/auth';
import AccountsInterface from '@/server/accounts/interface';
import AuthenticationInterface from '@/server/authentication/interface';

const jwtSecret = config.get<string>('jwt.secret');

export default class AuthenticationAPI {

  static install(app: Application, internalAPI: AuthenticationInterface, accountAPI: AccountsInterface): void {
    passport.use(new LocalStrategy({
      usernameField: 'email',
      passwordField: 'password',
    },
    async function(email: string, password: string, done: (error: any, user?: Account | boolean, info?: any) => void) {
      let account = await accountAPI.getAccountByEmail(email);

      if ( account ) {
        let passwordMatch = await internalAPI.checkPassword(account, password);

        if ( passwordMatch ) {
          return done(null, account);
        }
      }

      return done(null, false, { message: 'Incorrect email or password.' });
    }));

    passport.use(new passportJWT.Strategy({
      jwtFromRequest: passportJWT.ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: jwtSecret,
    }, async (jwtPayload, done) => {

      const account = await accountAPI.getAccountById(jwtPayload.id);

      if ( !account ) {
        return done(null, false, { message: 'Incorrect email or password.' });
      }

      return done(null, account);
    }));

    // Scoped, not global: a bare app.use(express.json()) would also consume
    // raw-body routes like the Stripe webhook (/api/funding/webhooks) and break
    // signature verification (pv-ufag).
    app.use('/api/auth/v1', express.json());

    const authenticationRoutes = new AuthenticationRoutes(internalAPI, accountAPI);
    authenticationRoutes.installHandlers(app, '/api/auth/v1');
  }
}
