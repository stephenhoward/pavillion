import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';

import ActivityPubEventHandlers from '@/server/activitypub/events';
import ActivityPubInterface from '@/server/activitypub/interface';
import UserActorService from '@/server/activitypub/service/user_actor';
import { UserActorEntity } from '@/server/activitypub/entity/user_actor';
import { AccountEntity } from '@/server/common/entity/account';
import db from '@/server/common/entity/db';

describe('ActivityPub account.created event handler', () => {
  let sandbox: sinon.SinonSandbox;
  let eventBus: EventEmitter;
  let activityPubInterface: ActivityPubInterface;
  let eventHandlers: ActivityPubEventHandlers;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    activityPubInterface = new ActivityPubInterface(eventBus);
    eventHandlers = new ActivityPubEventHandlers(activityPubInterface);
    eventHandlers.install(eventBus);

    // Sync database for test
    await db.sync({ force: true });
  });

  afterEach(() => {
    eventBus.removeAllListeners();
    sandbox.restore();
  });

  it('should create UserActor when account.created event is emitted', async () => {
    const accountId = uuidv4();
    const username = 'testuser';
    const domain = 'events.example';

    // Create account entity first (foreign key requirement)
    await AccountEntity.create({
      id: accountId,
      email: 'testuser@example.com',
      username: username,
      domain: domain,
      language: 'en',
    });

    const accountPayload = {
      accountId: accountId,
      username: username,
      domain: domain,
    };

    // Emit the event
    eventBus.emit('account.created', accountPayload);

    // Wait a bit for async event handler to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify UserActor was created
    const userActor = await UserActorEntity.findOne({
      where: { account_id: accountPayload.accountId },
    });

    expect(userActor).toBeDefined();
    expect(userActor?.actor_uri).toBe(`https://${domain}/users/${username}`);
  });

  it('should not create UserActor when username is empty', async () => {
    const accountPayload = {
      accountId: 'test-account-id-2',
      username: '',
      domain: 'events.example',
    };

    const createActorSpy = sandbox.spy(UserActorService.prototype, 'createActor');

    // Emit the event
    eventBus.emit('account.created', accountPayload);

    // Wait a bit for async event handler to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify UserActor was NOT created
    expect(createActorSpy.called).toBe(false);

    const userActor = await UserActorEntity.findOne({
      where: { account_id: accountPayload.accountId },
    });

    expect(userActor).toBeNull();
  });

  it('should log error but not fail when UserActor creation fails', async () => {
    const consoleErrorSpy = sandbox.stub(console, 'error');

    const accountPayload = {
      accountId: 'test-account-id-3',
      username: 'testuser2',
      domain: '', // Missing domain will cause error
    };

    // Emit the event
    eventBus.emit('account.created', accountPayload);

    // Wait a bit for async event handler to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify error was logged
    expect(consoleErrorSpy.called).toBe(true);
    expect(consoleErrorSpy.firstCall.args[0]).toContain('[ActivityPub]');
  });
});
