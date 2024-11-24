import config from 'config';
import express from 'express';
import path from "path";
import { router as indexRoutes } from './app_routes';
import AdminV1Routes from './accounts/api/v1';
import AuthV1Routes from './authentication/api/v1';
import db, { seedDB } from './common/entity/db';

const publicPath = path.join(path.resolve(), "public");
const distPath = path.join(path.resolve(), "dist");
const app: express.Application = express();

app.set("views", path.join(path.resolve(), "src/server/templates"));

// if (process.env.NODE_ENV === "production") {
//   app.use("/", express.static(distPath));
// } else {
//   app.use("/", express.static(publicPath));
// }

app.use('/', indexRoutes);

AuthV1Routes(app);
AdminV1Routes(app);

app.listen(config.get('host.port'), () => {
  if ( process.env.NODE_ENV == "development" ) {
    db.sync({force: true}).then(() => {
      seedDB();
    });
    console.log(`Pavillion listening at http://localhost:${config.get('host.port')}/`);
  }
});

export default app;