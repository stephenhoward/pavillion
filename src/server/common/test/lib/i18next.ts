import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';

export const initI18Next = () => {

  i18next.use(Backend).init({
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    // Load every shipped language up front so es/fr copy is really rendered, not the en fallback.
    preload: ['en', 'es', 'fr'],
    ns: fs.readdirSync(path.join(path.resolve(), 'src/server/locales/en')).map(f => f.replace(/\.json$/, '')),
    initAsync: false,
    backend: {
      loadPath: path.join(path.resolve(), "src/server/locales/{{lng}}/{{ns}}.json"),
    },
  });

  handlebars.registerHelper('t', function(key: string, options: any) {
    const lng = options.data.root.language || 'en';
    return i18next.t(key, { lng, ...options.hash });
  });
};
