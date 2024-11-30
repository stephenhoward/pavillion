import config from 'config';
import express from 'express';
import path from "path";
import { router as indexRoutes } from './app_routes';
import AdminV1Routes from './accounts/api/v1';
import AuthV1Routes from './authentication/api/v1';
import MemberV1Routes from './members/api/v1';
import db, { seedDB } from './common/entity/db';

const main = (): express.Application => {
    const app: express.Application = express();

    app.set("views", path.join(path.resolve(), "src/server/templates"));

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