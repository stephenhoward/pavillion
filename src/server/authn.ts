import passport from 'passport';
import express from 'express';
import { Strategy as LocalStrategy } from 'passport-local';
import passportJWT from 'passport-jwt';
import { Account } from '../model/account';
import AccountService from '../service/account';
import jwt from 'jsonwebtoken';

const jwtSecret = 'secret';  // TODO: add secret here

const serverAuth = {


    init: () => {
        passport.use(new LocalStrategy({
                usernameField: 'email',
                passwordField: 'password'
            },
            async function(email: string, password: string, done: (error: any, user?: Account | boolean, info?: any) => void) {
                let account = await AccountService.getAccountByEmail(email);

                if ( account ) {
                    let passwordMatch = await AccountService.checkPassword(account, password);

                    if ( passwordMatch ) {
                        //    return res.json({user, token});
                        return done(null, account);
                    }
                }

                return done(null, false, { message: 'Incorrect email or password.' });
            }
        ));

        passport.use(new passportJWT.Strategy({
            jwtFromRequest: passportJWT.ExtractJwt.fromAuthHeaderAsBearerToken(),
            secretOrKey: jwtSecret
        }, async (jwtPayload, done) => {

            const account = await AccountService.getAccountById(jwtPayload.id);

            if ( !account ) {
                return done(null, false, { message: 'Incorrect email or password.' });
            }

            return done(null, account);
        }));
    },
    login: (req: express.Request, res: express.Response ) => {
        passport.authenticate('local', {session: false}, (err: any, account: Account, info?: any) => {
            if (err || !account) {
                return res.status(400).json({
                    message: 'Something is not right',
                    user   : account
                });
            }
            req.login(account, {session: false}, (err: any) => {
                if (err) {
                    res.send(err);
                }
                // generate a signed json web token with the contents of user object and return it in the response
                let payload = {id: account.id};
                const token = jwt.sign(payload, jwtSecret);
                return res.json({payload, token});
            });
        })(req, res);
    }
}
export default serverAuth;