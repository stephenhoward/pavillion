import express from 'express';
import sinon from 'sinon';
import request from 'supertest';
import initPavillionServer from '@/server/server';
import crypto from 'crypto';
import db from '@/server/common/entity/db';

// Import entity modules to trigger registration with global db
import '@/server/common/entity/account';
import '@/server/accounts/entity/account_invitation';
import '@/server/calendar/entity/calendar';
import '@/server/calendar/entity/calendar_member';
import '@/server/calendar/entity/event_category';
import '@/server/calendar/entity/event_category_content';
import '@/server/calendar/entity/event';
import '@/server/calendar/entity/event_category_assignment';
import '@/server/calendar/entity/event_instance';
import '@/server/calendar/entity/event_repost';
import '@/server/calendar/entity/location';
import '@/server/activitypub/entity/activitypub';
import '@/server/activitypub/entity/event_object';
import '@/server/media/entity/media';
import '@/server/configuration/entity/settings';

export class TestEnvironment {
  app: express.Application;

  constructor() {
    this.app = express();
  }

  async init() {
    // Entities are now registered with global db (imported above)
    // Sync the database first
    await db.sync({ force: true });

    // Now initialize the server - this will skip db sync in test mode
    // In test mode, supertest works directly with the Express app object
    // without needing the server to actually listen on a port (port is ignored)
    // IMPORTANT: Must await this so server is fully initialized before tests run
    await initPavillionServer(this.app, 0);

    // Note: Setup mode middleware is active and will initially cache "setup mode active"
    // When tests create accounts via _setupAccount(), the cache is automatically cleared
    // This allows the middleware to query the database fresh and find the admin account
  }

  async cleanup() {
    // No-op: Don't close the database connection
    // With SQLite :memory:, the database is automatically destroyed when the process exits.
    // Explicitly closing causes race conditions with pending async operations.
    // When fileParallelism is enabled, each worker process gets its own isolated
    // in-memory database via vitest's module isolation, so no cleanup is needed.
  }

  async login(email: string, password: string): Promise<string> {
    const authResponse = await request(this.app).post('/api/auth/v1/login').send({ email, password });
    return authResponse.text;
  }

  async authPost(authKey: string, url: string, data: any): Promise<any> {
    return request(this.app)
      .post(url)
      .set('Authorization','Bearer ' + authKey)
      .send(data);
  }

  async authGet(authKey: string, url: string): Promise<any> {
    return request(this.app)
      .get(url)
      .set('Authorization','Bearer ' + authKey);
  }

  async authPut(authKey: string, url: string, data: any): Promise<any> {
    return request(this.app)
      .put(url)
      .set('Authorization','Bearer ' + authKey)
      .send(data);
  }

  async authDelete(authKey: string, url: string): Promise<any> {
    return request(this.app)
      .delete(url)
      .set('Authorization','Bearer ' + authKey);
  }

  async signedPost(url: string, authKey: string, requestData: any): Promise<any> {
    return await request(this.app)
      .post(url)
      .set('Authorization', authKey )
      .set('Date', new Date().toUTCString())
      .set('Digest', 'SHA-256='+crypto.createHash('sha256').update(JSON.stringify(requestData)).digest('base64'))
      .send(requestData);
  }

  stubRemoteCalendar(getStub: sinon.SinonStub, remoteDomain: string, calendarName: string) {
    // WebFinger uses the full acct:username@domain format
    const webfingerStub = getStub.withArgs(`https://${remoteDomain}/.well-known/webfinger?resource=acct:${calendarName}@${remoteDomain}`);
    webfingerStub.resolves({
      data: {
        links: [
          { rel:'self', href:`https://${remoteDomain}/calendars/${calendarName}` },
        ],
      },
    });

    const profileStub = getStub.withArgs(`https://${remoteDomain}/calendars/${calendarName}`);
    profileStub.resolves({
      status: 200,
      data: {
        inbox: `https://${remoteDomain}/calendars/${calendarName}/inbox`,
        publicKey: {
          publicKeyPem: 'fake key',
        },
      },
    });
  }

  fakeRemoteAuth(remoteDomain: string, calendarName: string ){
    return `Signature keyId="https://${remoteDomain}/calendars/${calendarName}#main_key",algorithm="rsa-sha256",` +
                    'headers="(request-target) host date content-type digest",' +
                    'signature="fakeSignature"';

  }
}
