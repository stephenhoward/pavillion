import config from 'config';
import express from 'express';
import path from "path";
import handlebars from 'handlebars';
import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import { EventEmitter } from 'events';

import db, { seedDB } from '@/server/common/entity/db';
import { router as indexRoutes } from '@/server/app_routes';
import AccountsDomain from '@/server/accounts';
import ActivityPubDomain from './activitypub';
import AuthenticationDomain from './authentication';
import CalendarDomain from '@/server/calendar';
import ConfigurationDomain from './configuration';
import PublicCalendarDomain from './public';

/**
 * Initializes the Pavillion server with express application configuration.
 * Sets up view templates, internationalization, API routes and starts the server listener.
 *
 * @param {express.Application} app - The Express application instance to configure
 */
const initPavillionServer = async (app: express.Application) => {

  app.set("views", path.join(path.resolve(), "src/server/templates"));
  // Initialize i18next with default configuration
  i18next.use(Backend).init({
    fallbackLng: 'en',
    initAsync: false,
    backend: {
      loadPath: path.join(path.resolve(), "src/server/locales/{{lng}}/{{ns}}.json"),
    },
  });

  // Add a global translation helper to Handlebars
  handlebars.registerHelper('t', function(key: string, options: any) {
    const lng = options.data.root.language || 'en';
    return i18next.t(key, { lng, ...options.hash });
  });

  // TODO: figure out dev vs prod asset serving
  // const publicPath = path.join(path.resolve(), "public");
  // const distPath = path.join(path.resolve(), "dist");
  // if (process.env.NODE_ENV === "production") {
  //   app.use("/", express.static(distPath));
  // } else {
  //   app.use("/", express.static(publicPath));
  // }

  app.use('/', indexRoutes);

  const eventBus = new EventEmitter();

  new AccountsDomain(eventBus).initialize(app);
  new ActivityPubDomain(eventBus).initialize(app);
  new AuthenticationDomain(eventBus).initialize(app);
  new ConfigurationDomain(eventBus).initialize(app);
  const calendarDomain = new CalendarDomain(eventBus);
  calendarDomain.initialize(app);
  new PublicCalendarDomain(eventBus).initialize(app);

  app.listen(config.get('host.port'), () => {
    if ( process.env.NODE_ENV == "development" ) {
      db.sync({force: true}).then(() => {
        seedDB().then(() => {
          calendarDomain.interface.refreshAllEventInstances();
        });
      });
      console.log(`Pavillion listening at http://localhost:${config.get('host.port')}/`);
    }
  });
};

export default initPavillionServer;
