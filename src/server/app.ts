import express from 'express';
import path from "path";
import serverAuth from './authn';
import indexRouter from './routes/index';
import apiV1Routes from './routes/api/v1';
// import activityPubRoutes from './routes/activitypub';
import assetsRoutes from './routes/assets';
import db, { seedDB } from '../entity/db';

const publicPath = path.join(path.resolve(), "public");
const distPath = path.join(path.resolve(), "dist");
const port: number=3000;

serverAuth.init();

const app: express.Application = express();
app.set("views", path.join(path.resolve(), "src/server/templates"));

if (process.env.NODE_ENV === "production") {
    app.use("/", express.static(distPath));
  } else {
    app.use("/", express.static(publicPath));
    app.use("/src", assetsRoutes);
  }

  app.use('/', indexRouter);

apiV1Routes(app);
// activityPubRoutes(app);

app.listen(port, () => {
  console.log(process.env.NODE_ENV);
  if ( process.env.NODE_ENV == "development" ) {
      db.sync({force: true}).then(() => {
        seedDB();
      });
      app._router.stack.forEach((middleware: any) => {
        if (middleware.route) { // Routes registered directly on the app
            console.log(`${Object.keys(middleware.route.methods).join(', ').toUpperCase()} ${middleware.route.path}`);
        } else if (middleware.name === 'router') { // Routes added as router middleware
            middleware.handle.stack.forEach((handler: any) => {
                if (handler.route) {
                    console.log(`${Object.keys(handler.route.methods).join(', ').toUpperCase()} ${handler.route.path}`);
                }
            });
        }
    });  
  }
  console.log(`TypeScript with Express http://localhost:${port}/`);
});

