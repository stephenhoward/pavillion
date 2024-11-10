import express from 'express';
import path from "path";
import serverAuth from './authn';
import indexRouter from './routes/index';
import apiV1Routes from './routes/api/v1';
// import activityPubRoutes from './routes/activitypub';
import assetsRoutes from './routes/assets';


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
    console.log(`TypeScript with Express http://localhost:${port}/`);
});

console.log(app.routes);