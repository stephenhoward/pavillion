import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import handlebars from 'handlebars';
import path from 'path';

export const initI18Next = () => {

    i18next.use(Backend).init({
        fallbackLng: 'en',
        initAsync: false,
        backend: {
            loadPath: path.join(path.resolve(), "src/server/locales/{{lng}}/{{ns}}.json"),
        }
    });

    handlebars.registerHelper('t', function(key: string, options: any) {
        const lng = options.data.root.language || 'en';
        return i18next.t(key, { lng, ...options.hash });
    });
}
