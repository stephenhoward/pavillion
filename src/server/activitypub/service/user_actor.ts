import { generateKeyPairSync, createSign, createVerify } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import { Account } from '@/common/model/account';
import { UserActorEntity, UserActor } from '@/server/activitypub/entity/user_actor';
import { AccountEntity } from '@/server/common/entity/account';
import { CalendarMemberEntity } from '@/server/calendar/entity/calendar_member';
import RemoteCalendarService from '@/server/activitypub/service/remote_calendar';

/**
 * HTTP Signature object for ActivityPub requests
 */
export interface HttpSignature {
  keyId: string;
  signature: string;
  algorithm: string;
  headers: string;
  date: string;
}

/**
 * Service for managing User ActivityPub Person actors with keypairs
 *
 * @remarks
 * This service handles keypair generation, actor creation, and HTTP signature
 * signing/verification for federated user identities.
 */
export default class UserActorService {

  /**
   * Creates a new UserActor with RSA-2048 keypair for an account
   *
   * @param account - The account to create an actor for
   * @param domain - The instance domain (e.g., 'events.example')
   * @returns Promise resolving to the created UserActor
   */
  async createActor(account: Account, domain: string): Promise<UserActor> {
    // Generate RSA-2048 keypair using Node.js crypto
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Construct actor URI
    const actorUri = `https://${domain}/users/${account.username}`;

    // Create entity
    const entity = await UserActorEntity.create({
      id: uuidv4(),
      actor_type: 'local',
      account_id: account.id,
      actor_uri: actorUri,
      public_key: publicKey,
      private_key: privateKey,
    });

    return entity.toModel();
  }

  /**
   * Retrieves a UserActor by username
   *
   * @param username - The username to look up
   * @returns Promise resolving to UserActor or null if not found
   */
  async getActorByUsername(username: string): Promise<UserActor | null> {
    // First find the account by username
    const account = await AccountEntity.findOne({
      where: { username },
    });

    if (!account) {
      return null;
    }

    // Then find the associated actor
    const entity = await UserActorEntity.findOne({
      where: { account_id: account.id },
    });

    if (!entity) {
      return null;
    }

    return entity.toModel();
  }

  /**
   * Retrieves a UserActor by account ID
   *
   * @param accountId - The account ID to look up
   * @returns Promise resolving to UserActor or null if not found
   */
  async getActorByAccountId(accountId: string): Promise<UserActor | null> {
    const entity = await UserActorEntity.findOne({
      where: { account_id: accountId },
    });

    if (!entity) {
      return null;
    }

    return entity.toModel();
  }

  /**
   * Retrieves a UserActor by actor URI
   *
   * @param actorUri - The actor URI to look up
   * @returns Promise resolving to UserActor or null if not found
   */
  async getActorByUri(actorUri: string): Promise<UserActor | null> {
    const entity = await UserActorEntity.findOne({
      where: { actor_uri: actorUri },
    });

    if (!entity) {
      return null;
    }

    return entity.toModel();
  }

  /**
   * Finds an existing remote actor by URI, or creates a new one.
   * Used when granting remote editor access via federation.
   */
  async findOrCreateRemoteActor(actorUri: string, remoteUsername: string, remoteDomain: string, publicKey?: string): Promise<UserActor> {
    const existing = await UserActorEntity.findOne({
      where: { actor_uri: actorUri },
    });

    if (existing) {
      return existing.toModel();
    }

    const entity = await UserActorEntity.create({
      id: uuidv4(),
      actor_type: 'remote',
      account_id: null,
      actor_uri: actorUri,
      remote_username: remoteUsername,
      remote_domain: remoteDomain,
      public_key: publicKey || null,
      private_key: null,
    });

    return entity.toModel();
  }

  /**
   * Signs an ActivityPub activity with HTTP signatures
   *
   * @param actorUri - The actor URI performing the activity
   * @param activity - The ActivityPub activity object
   * @param targetUrl - The target URL (inbox) the activity is being sent to
   * @returns Promise resolving to HttpSignature object
   */
  async signActivity(actorUri: string, activity: any, targetUrl: string): Promise<HttpSignature> {
    // Retrieve actor with private key
    const actor = await this.getActorByUri(actorUri);
    if (!actor) {
      throw new Error(`Actor not found: ${actorUri}`);
    }

    if (!actor.privateKey) {
      throw new Error(`Actor ${actorUri} does not have a private key (remote actors cannot sign activities)`);
    }

    // Parse target URL for host
    const url = new URL(targetUrl);
    const host = url.host;
    const path = url.pathname + url.search;

    // Generate date header
    const date = new Date().toUTCString();

    // Create signing string
    const requestTarget = `post ${path}`;
    const signingString = [
      `(request-target): ${requestTarget}`,
      `host: ${host}`,
      `date: ${date}`,
    ].join('\n');

    // Sign the string with private key
    const signer = createSign('RSA-SHA256');
    signer.update(signingString);
    signer.end();

    const signatureBytes = signer.sign(actor.privateKey);
    const signatureBase64 = signatureBytes.toString('base64');

    return {
      keyId: `${actorUri}#main-key`,
      signature: signatureBase64,
      algorithm: 'rsa-sha256',
      headers: '(request-target) host date',
      date: date,
    };
  }

  /**
   * Verifies an HTTP signature on an incoming request
   *
   * @param request - The HTTP request object with signature headers
   * @param actorUri - The actor URI that supposedly signed the request
   * @returns Promise resolving to true if signature is valid, false otherwise
   */
  async verifySignature(request: any, actorUri: string): Promise<boolean> {
    try {
      // Retrieve actor with public key
      const actor = await this.getActorByUri(actorUri);
      if (!actor) {
        console.error(`Actor not found for verification: ${actorUri}`);
        return false;
      }

      if (!actor.publicKey) {
        console.error(`Actor ${actorUri} does not have a public key`);
        return false;
      }

      // Extract signature from headers
      const signatureHeader = request.headers.signature;
      const dateHeader = request.headers.date;

      if (!signatureHeader || !dateHeader) {
        console.error('Missing signature or date header');
        return false;
      }

      // Parse signature header components
      // Format: keyId="...",signature="...",algorithm="...",headers="..."
      const signatureParts: any = {};
      signatureHeader.split(',').forEach((part: string) => {
        const [key, ...valueParts] = part.split('=');
        const value = valueParts.join('=').replace(/"/g, '');
        signatureParts[key.trim()] = value;
      });

      const signature = signatureParts.signature;
      if (!signature) {
        console.error('Signature not found in header');
        return false;
      }

      // Reconstruct signing string based on headers that were signed
      const headers = signatureParts.headers || '(request-target) host date';
      const headerList = headers.split(' ');

      const signingParts = headerList.map((header: string) => {
        if (header === '(request-target)') {
          const method = request.method.toLowerCase();
          const path = request.url;
          return `(request-target): ${method} ${path}`;
        }
        return `${header}: ${request.headers[header]}`;
      });

      const signingString = signingParts.join('\n');

      // Verify signature with public key
      const verifier = createVerify('RSA-SHA256');
      verifier.update(signingString);
      verifier.end();

      const signatureBuffer = Buffer.from(signature, 'base64');
      const isValid = verifier.verify(actor.publicKey, signatureBuffer);

      return isValid;
    }
    catch (error) {
      console.error('Error verifying signature:', error);
      return false;
    }
  }

  /**
   * Processes an Add activity (used when remote instance grants editor access to local user)
   *
   * @param username - The local username receiving the activity
   * @param activity - The ActivityPub Add activity
   * @returns Promise resolving to true if processed successfully
   */
  async processAddActivity(username: string, activity: any): Promise<boolean> {
    // Validate the activity structure
    if (activity.type !== 'Add') {
      console.error(`[USER INBOX] Invalid activity type: ${activity.type}`);
      return false;
    }

    // Get the local user actor
    const actor = await this.getActorByUsername(username);
    if (!actor) {
      console.error(`[USER INBOX] User not found: ${username}`);
      return false;
    }

    // Extract target (the calendar's editors collection) and object (our user)
    const _target = activity.target; // e.g., "https://alpha.federation.local/calendars/events/editors"
    const object = activity.object; // e.g., "https://beta.federation.local/users/Admin"

    // Verify the object is us
    if (object !== actor.actorUri) {
      console.error(`[USER INBOX] Add activity object doesn't match our actor: ${object} vs ${actor.actorUri}`);
      return false;
    }

    // Extract calendar info from the actor (the calendar that sent the Add)
    const calendarActorUri = activity.actor; // e.g., "https://alpha.federation.local/calendars/events"
    const calendarInboxUrl = activity.calendarInboxUrl; // The calendar's inbox URL

    if (!calendarActorUri) {
      console.error('[USER INBOX] Missing calendar actor URI in Add activity');
      return false;
    }

    // Get the account ID for the local user
    const account = await AccountEntity.findOne({
      where: { username },
    });

    if (!account) {
      console.error(`[USER INBOX] Account not found for username: ${username}`);
      return false;
    }

    // Find or create the remote CalendarActorEntity
    const remoteCalendarService = new RemoteCalendarService();
    const remoteCalendarActor = await remoteCalendarService.findOrCreateByActorUri(calendarActorUri);

    // Update inbox URL if provided
    if (calendarInboxUrl) {
      await remoteCalendarService.updateMetadata(calendarActorUri, {
        inboxUrl: calendarInboxUrl,
      });
    }

    // Check if membership already exists
    const existingMember = await CalendarMemberEntity.findOne({
      where: {
        calendar_actor_id: remoteCalendarActor.id,
        account_id: account.id,
      },
    });

    if (existingMember) {
      console.log(`[USER INBOX] Remote calendar membership already exists for calendar ${calendarActorUri}`);
      return true;
    }

    // Create CalendarMemberEntity to record the editor access on the remote calendar
    await CalendarMemberEntity.create({
      id: uuidv4(),
      calendar_id: null, // This is a remote calendar, not local
      calendar_actor_id: remoteCalendarActor.id,
      account_id: account.id,
      user_actor_id: null,
      role: 'editor',
      granted_by: null, // Remote grant, no local grantor
    });

    console.log(`[USER INBOX] Created remote calendar membership for user ${username} to calendar ${calendarActorUri}`);
    return true;
  }

  /**
   * Processes a Remove activity (used when remote instance revokes editor access from local user)
   *
   * @param username - The local username receiving the activity
   * @param activity - The ActivityPub Remove activity
   * @returns Promise resolving to true if processed successfully
   */
  async processRemoveActivity(username: string, activity: any): Promise<boolean> {
    // Validate the activity structure
    if (activity.type !== 'Remove') {
      console.error(`[USER INBOX] Invalid activity type: ${activity.type}`);
      return false;
    }

    // Get the local user actor
    const actor = await this.getActorByUsername(username);
    if (!actor) {
      console.error(`[USER INBOX] User not found: ${username}`);
      return false;
    }

    // Extract the calendar actor URI from the activity
    const calendarActorUri = activity.actor;

    if (!calendarActorUri) {
      console.error('[USER INBOX] Missing calendar actor URI in Remove activity');
      return false;
    }

    // Get the account ID for the local user
    const account = await AccountEntity.findOne({
      where: { username },
    });

    if (!account) {
      console.error(`[USER INBOX] Account not found for username: ${username}`);
      return false;
    }

    // Find the remote CalendarActorEntity by actor URI
    const remoteCalendarService = new RemoteCalendarService();
    const remoteCalendarActor = await remoteCalendarService.getByActorUri(calendarActorUri);

    if (!remoteCalendarActor) {
      console.log(`[USER INBOX] Remote calendar actor not found for URI: ${calendarActorUri}`);
      return false;
    }

    // Delete the CalendarMemberEntity
    const deleted = await CalendarMemberEntity.destroy({
      where: {
        calendar_actor_id: remoteCalendarActor.id,
        account_id: account.id,
      },
    });

    console.log(`[USER INBOX] Removed remote calendar membership for user ${username} to calendar ${calendarActorUri} (deleted: ${deleted})`);
    return true;
  }
}
