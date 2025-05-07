import express from 'express';
import initPavillionServer from '@/server/server';

const main = (providedApp?: express.Application): express.Application => {
  const app: express.Application = providedApp || express();

  initPavillionServer(app);

  return app;
};

main();

export default main;
