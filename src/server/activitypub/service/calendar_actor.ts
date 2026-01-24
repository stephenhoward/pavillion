import { generateKeyPairSync, createSign, createVerify } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import { Calendar } from '@/common/model/calendar';
import { CalendarActorEntity, CalendarActor } from '@/server/activitypub/entity/calendar_actor';
import { CalendarEntity } from '@/server/calendar/entity/calendar';

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
 * Service for managing Calendar ActivityPub Group actors with keypairs
 *
 * @remarks
 * This service handles keypair generation, actor creation, and HTTP signature
 * signing/verification for federated calendar identities.
 */
export default class CalendarActorService {

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
    const calendar = await CalendarEntity.findOne({
      where: { url_name: urlName },
    });

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
      throw new Error(`Calendar actor not found: ${actorUri}`);
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
        console.error(`Calendar actor not found for verification: ${actorUri}`);
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
      console.error('Error verifying calendar actor signature:', error);
      return false;
    }
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
