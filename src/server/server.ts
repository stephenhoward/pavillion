import config from 'config';
import express from 'express';
import path from "path";

import db, { seedDB } from '@/server/common/entity/db';
import { router as indexRoutes } from '@/server/app_routes';
import AccountsAPI from '@/server/accounts/api/v1';
import AuthenticationAPI from '@/server/authentication/api/v1';
import MemberAPI from '@/server/calendar/api/v1';
import ActivityPubAPI from '@/server/activitypub/api/v1';
import ConfigurationAPI from '@/server/configuration/api/v1';

const initPavillionServer = (app: express.Application) => {

        app.set("views", path.join(path.resolve(), "src/server/templates"));

        // TODO: figure out dev vs prod asset serving
        // const publicPath = path.join(path.resolve(), "public");
        // const distPath = path.join(path.resolve(), "dist");
        // if (process.env.NODE_ENV === "production") {
        //   app.use("/", express.static(distPath));
        // } else {
        //   app.use("/", express.static(publicPath));
        // }

        app.use('/', indexRoutes);

        ConfigurationAPI(app);
        AuthenticationAPI(app);
        AccountsAPI(app);
        let memberAPI = new MemberAPI(app);
        let activitypubAPI = new ActivityPubAPI(app);
        activitypubAPI.registerListeners(memberAPI);

        app.listen(config.get('host.port'), () => {
            if ( process.env.NODE_ENV == "development" ) {
                db.sync({force: true}).then(() => {
                seedDB();
                });
                console.log(`Pavillion listening at http://localhost:${config.get('host.port')}/`);
            }
        });
};

export default initPavillionServer;