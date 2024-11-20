import express from 'express';
import ActivitypubExpress from 'activitypub-express';
// import eventsRouter from './v1/events';

const routes = {
    actor: '/u/:actor',
    object: '/o/:id',
    activity: '/s/:id',
    inbox: '/u/:actor/inbox',
    outbox: '/u/:actor/outbox',
    followers: '/u/:actor/followers',
    following: '/u/:actor/following',
    liked: '/u/:actor/liked',
    collections: '/u/:actor/c/:id',
    blocked: '/u/:actor/blocked',
    rejections: '/u/:actor/rejections',
    rejected: '/u/:actor/rejected',
    shares: '/s/:id/shares',
    likes: '/s/:id/likes'
}

const apex = ActivitypubExpress({
    name: 'Pavillion ActivityPub Server',
    version: '1.0.0',
    domain: 'localhost',
    actorParam: 'actor',
    objectParam: 'id',
    activityParam: 'id',
    routes,
    endpoints: {
      proxyUrl: 'https://localhost/proxy'
    }
});

const activityPub = (app: express.Application) => {
    const router = express.Router();

    app.use(
        express.json({ type: apex.consts.jsonldTypes }),
        express.urlencoded({ extended: true }),
        apex
    );
};

export default activityPub;