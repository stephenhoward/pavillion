import config from 'config';
import express from 'express';
import path from "path";

import db, { seedDB } from '@/server/common/entity/db';
import { router as indexRoutes } from '@/server/app_routes';
import AdminV1Routes from '@/server/accounts/api/v1';
import AuthV1Routes from '@/server/authentication/api/v1';
import MemberV1Routes from '@/server/members/api/v1';

const main = (providedApp?: express.Application): express.Application => {
    const app: express.Application = providedApp || express();

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

    AuthV1Routes(app);
    AdminV1Routes(app);
    MemberV1Routes(app);

    app.listen(config.get('host.port'), () => {
      if ( process.env.NODE_ENV == "development" ) {
        db.sync({force: true}).then(() => {
          seedDB();
        });
        console.log(`Pavillion listening at http://localhost:${config.get('host.port')}/`);
      }
    });

    return app;
};

main();

export default main;