import express, { Request, Response, Router } from 'express';
import { Account } from '@/common/model/account';

const addRequestUser = (req: Request, _res: Response, next: express.NextFunction): void => {
  req.user = new Account('id', 'testme', 'testme');
  next();
};

const testApp = (router: Router ): express.Application => {

  let app = express();
  app.use(express.json());
  app.use('/', router);

  return app;
};

const countRoutes = (app: express.Application): number => {
  let count = 0;
  if( app._router && app._router.stack ) {
    app._router.stack.forEach((middleware: any) => {
      if (middleware.route) { // Routes registered directly on the app
        count++;
      }
      else if (middleware.name === 'router') { // Routes added as router middleware
        middleware.handle.stack.forEach((handler: any) => {
          if (handler.route) {
            count++;
          }
        });
      }
    });
  }
  return count;
};

export {
  addRequestUser,
  countRoutes,
  testApp,
};
