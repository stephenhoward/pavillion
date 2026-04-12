import { generateKeyPairSync, createSign } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import { Calendar } from '@/common/model/calendar';
import { CalendarActorEntity, CalendarActor } from '@/server/activitypub/entity/calendar_actor';
import CalendarInterface from '@/server/calendar/interface';
import { HttpSignature } from '@/server/activitypub/types';

export type { HttpSignature };

/**
 * Service for managing Calendar ActivityPub Group actors with keypairs
 *
 * @remarks
 * This service handles keypair generation, actor creation, and HTTP signature
 * signing for federated calendar identities. Signature verification is handled
 * by the verifyHttpSignature middleware in http_signature.ts.
 */
export default class CalendarActorService {
  private calendarInterface: CalendarInterface;

  constructor(calendarInterface: CalendarInterface) {
    this.calendarInterface = calendarInterface;
  }

  /**
   * Creates a new CalendarActor with RSA-2048 keypair for a calendar
   *
   * @param calendar - The calendar to create an actor for
   * @param domain - The instance domain (e.g., 'events.example')
   * @returns Promise resolving to the created CalendarActor
   */
  async createActor(calendar: Calendar, domain: string): Promise<CalendarActor> {
    // Generate RSA-2048 keypair using Node.js crypto
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Construct actor URI
    const actorUri = `https://${domain}/calendars/${calendar.urlName}`;

    // Create entity
    const entity = await CalendarActorEntity.create({
      id: uuidv4(),
      calendar_id: calendar.id,
      actor_uri: actorUri,
      public_key: publicKey,
      private_key: privateKey,
    });

    return entity.toModel();
  }

  /**
   * Retrieves a CalendarActor by calendar URL name
   *
   * @param urlName - The calendar URL name to look up
   * @returns Promise resolving to CalendarActor or null if not found
   */
  async getActorByUrlName(urlName: string): Promise<CalendarActor | null> {
    // First find the calendar by URL name
    const calendar = await this.calendarInterface.getCalendarByName(urlName);

    if (!calendar) {
      return null;
    }

    // Then find the associated actor
    const entity = await CalendarActorEntity.findOne({
      where: { calendar_id: calendar.id },
    });

    if (!entity) {
      return null;
    }

    return entity.toModel();
  }

  /**
   * Retrieves a CalendarActor by calendar ID
   *
   * @param calendarId - The calendar ID to look up
   * @returns Promise resolving to CalendarActor or null if not found
   */
  async getActorByCalendarId(calendarId: string): Promise<CalendarActor | null> {
    const entity = await CalendarActorEntity.findOne({
      where: { calendar_id: calendarId },
    });

    if (!entity) {
      return null;
    }

    return entity.toModel();
  }

  /**
   * Retrieves a CalendarActor by actor URI
   *
   * @param actorUri - The actor URI to look up
   * @returns Promise resolving to CalendarActor or null if not found
   */
  async getActorByUri(actorUri: string): Promise<CalendarActor | null> {
    const entity = await CalendarActorEntity.findOne({
      where: { actor_uri: actorUri },
    });

    if (!entity) {
      return null;
    }

    return entity.toModel();
  }

  /**
   * Resolves an ActivityPub actor URI to a local Calendar object, or null
   * if the URI does not belong to a local calendar actor on this instance.
   *
   * Narrow read-only helper used by ProcessOutboxService to decide whether
   * to route a recipient via in-process dispatch (local) or HTTP (remote).
   * Deliberately does NOT call remote_calendar.ts's findOrCreateByActorUri,
   * which has create-on-miss semantics inappropriate for dispatch lookup.
   *
   * @param actorUri - The actor URI to resolve
   * @returns Promise resolving to Calendar or null if not a local actor
   */
  async getLocalCalendarByActorUri(actorUri: string): Promise<Calendar | null> {
    const actor = await CalendarActorEntity.findOne({
      where: { actor_uri: actorUri, actor_type: 'local' },
    });
    if (!actor || !actor.calendar_id) {
      return null;
    }
    return await this.calendarInterface.getCalendar(actor.calendar_id);
  }

  /**
   * Signs an ActivityPub activity with HTTP signatures
   *
   * @param actorUri - The actor URI performing the activity
   * @param activity - The ActivityPub activity object
   * @param targetUrl - The target URL (inbox) the activity is being sent to
   * @param digest - Optional Digest header value to include in the signature
   * @returns Promise resolving to HttpSignature object
   */
  async signActivity(actorUri: string, activity: any, targetUrl: string, digest?: string): Promise<HttpSignature> {
    // Retrieve actor with private key
    const actor = await this.getActorByUri(actorUri);
    if (!actor) {
      throw new Error(`Calendar actor not found: ${actorUri}`);
    }

    if (!actor.privateKey) {
      throw new Error(`Calendar actor ${actorUri} does not have a private key`);
    }

    // Parse target URL for host
    const url = new URL(targetUrl);
    const host = url.host;
    const path = url.pathname + url.search;

    // Generate date header
    const date = new Date().toUTCString();

    // Create signing string
    const requestTarget = `post ${path}`;
    const signingStringParts = [
      `(request-target): ${requestTarget}`,
      `host: ${host}`,
      `date: ${date}`,
    ];
    if (digest) {
      signingStringParts.push(`digest: ${digest}`);
    }
    const signingString = signingStringParts.join('\n');

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
      headers: digest ? '(request-target) host date digest' : '(request-target) host date',
      date: date,
    };
  }

  /**
   * Gets the public key for a calendar by URL name
   *
   * @param urlName - The calendar URL name
   * @returns Promise resolving to the public key PEM or null if not found
   */
  async getPublicKeyByUrlName(urlName: string): Promise<string | null> {
    const actor = await this.getActorByUrlName(urlName);
    return actor?.publicKey || null;
  }

  /**
   * Gets the public key for a calendar by calendar ID
   *
   * @param calendarId - The calendar ID
   * @returns Promise resolving to the public key PEM or null if not found
   */
  async getPublicKeyByCalendarId(calendarId: string): Promise<string | null> {
    const actor = await this.getActorByCalendarId(calendarId);
    return actor?.publicKey || null;
  }
}
