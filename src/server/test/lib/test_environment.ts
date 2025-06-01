import express from 'express';
import db from '@/server/common/entity/db';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';
import request from 'supertest';
import initPavillionServer from '@/server/server';
import crypto from 'crypto';
import { AccountEntity, AccountRoleEntity, AccountSecretsEntity } from'@/server/common/entity/account';
import AccountsInterface from '@/server/accounts/interface';
import EventEmtter from 'events';
import { Account } from '@/common/model/account';


export class TestEnvironment {
  app: express.Application;

  constructor() {
    this.app = express();
  }

  async init() {
    await db.sync({ force: true });
    initPavillionServer(this.app);
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

  async signedPost(url: string, authKey: string, requestData: any): Promise<any> {
    return await request(this.app)
      .post(url)
      .set('Authorization', authKey )
      .set('Date', new Date().toUTCString())
      .set('Digest', 'SHA-256='+crypto.createHash('sha256').update(JSON.stringify(requestData)).digest('base64'))
      .send(requestData);
  }

  // Create user account directly in database for tests
  async createTestUser(email: string, password: string, roles: string[] = []): Promise<Account> {

    const accountEntity = await AccountEntity.create({
      id: uuidv4(),
      email: email,
      language: 'en',
    });

    // Create account secrets entity (required for password setting)
    await AccountSecretsEntity.create({
      account_id: accountEntity.id,
    });

    // Add roles
    for (const role of roles) {
      await AccountRoleEntity.create({
        account_id: accountEntity.id,
        role: role,
      });
    }

    const account = accountEntity.toModel();
    await (new AccountsInterface(new EventEmtter())).setPassword(account, password);

    return account;
  }

  stubRemoteCalendar(getStub: sinon.SinonStub, remoteDomain: string, calendarName: string) {
    const webfingerStub = getStub.withArgs(`https://${remoteDomain}/.well-known/webfinger?resource=acct:${calendarName}`);
    webfingerStub.resolves({
      data: {
        links: [
          { rel:'self', href:`https://${remoteDomain}/o/${calendarName}` },
        ],
      },
    });

    const profileStub = getStub.withArgs(`https://${remoteDomain}/o/${calendarName}`);
    profileStub.resolves({
      status: 200,
      data: {
        inbox: `https://${remoteDomain}/o/${calendarName}/inbox`,
        publicKey: {
          publicKeyPem: 'fake key',
        },
      },
    });
  }

  fakeRemoteAuth(remoteDomain: string, calendarName: string ){
    return `Signature keyId="https://${remoteDomain}/o/${calendarName}#main_key",algorithm="rsa-sha256",` +
                    'headers="(request-target) host date content-type digest",' +
                    'signature="fakeSignature"';

  }
}
