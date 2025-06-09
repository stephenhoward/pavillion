import { Request, Response, NextFunction } from 'express';
import httpSignature from 'http-signature';
import axios from 'axios';
import { URL } from 'url';
import { ClientRequest } from 'http';
import crypto from 'crypto';
import { Cache } from '@/server/activitypub/helper/cache';

// A key cache to prevent frequent key fetching
const keyCache = new Cache<string>(60 * 60 * 1000); // 1 hour expiration

/**
 * Express middleware for verifying HTTP signatures in ActivityPub requests.
 * Implements the HTTP Signature verification spec for securing ActivityPub interactions.
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {NextFunction} next - Express next middleware function
 * @returns {Promise<void>}
 */
export async function verifyHttpSignature(req: Request, res: Response, next: NextFunction) {
  try {
    // Parse the signature header
    const parsedSignature = httpSignature.parseRequest(req as unknown as ClientRequest);
    if ( ! parsedSignature ) {
      return res.status(401).json({error: 'Signature required'});
    }

    // Validate required signature parameters
    if ( ! parsedSignature.params.keyId || ! parsedSignature.params.signature ) {
      return res.status(401).json({ error: 'Invalid signature format - missing required parameters' });
    }

    // Validate required headers are included in the signature
    const requiredHeaders = ['(request-target)', 'host', 'date'];

    if (!requiredHeaders.every(header => parsedSignature.params.headers.includes(header))) {
      return res.status(401).json({ error: 'Invalid signature format - missing required headers in signature' });
    }

    // Check if date header is recent (within 30 seconds) to prevent replay attacks
    if (req.headers.date) {
      const requestDate = new Date(req.headers.date as string).getTime();
      const currentDate = new Date().getTime();
      if (Math.abs(currentDate - requestDate) > 30000) { // 30 seconds
        return res.status(401).json({ error: 'Request date is too old or in the future' });
      }
    }

    // Verify digest header if present to ensure body integrity
    if (req.headers.digest && req.body) {
      const digest = req.headers.digest as string;
      const parsedDisgest = digest.match(/^([a-zA-Z0-9-]+)=(.+)$/);

      if ( ! parsedDisgest ) {
        return res.status(401).json({ error: 'Invalid digest' });
      }

      const algorithm = parsedDisgest[1];
      const encodedHash = parsedDisgest[2];

      if (algorithm !== 'SHA-256') {
        return res.status(401).json({ error: 'Unsupported digest algorithm' });
      }

      const calculatedHash = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('base64');

      if (encodedHash !== calculatedHash) {
        return res.status(401).json({ error: 'Invalid digest' });
      }
    }

    // Fetch the public key from the keyId URL (with caching)
    const publicKey = await getPublicKey(parsedSignature.params.keyId);
    if (!publicKey) {
      return res.status(401).json({ error: 'Could not retrieve public key' });
    }

    // Verify the signature
    if (! httpSignature.verifySignature(parsedSignature, publicKey) ) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Check if the actor has permission for this operation
    const actorPermission = await verifyActorPermission(req.body.actor, parsedSignature.params.keyId);
    if (!actorPermission) {
      return res.status(403).json({ error: 'Actor does not have permission for this operation' });
    }

    next();
  }
  catch(error) {
    console.error('Error verifying HTTP signature', error);
    res.status(500).json({error: 'Error verifying HTTP signature'});
  }
}

/**
 * Gets a public key with caching support to reduce network requests.
 *
 * @param {string} keyId - The key identifier URL
 * @returns {Promise<string|null>} The public key as a string, or null if retrieval fails
 */
async function getPublicKey(keyId: string): Promise<string | null> {
  // Check cache first
  const cachedKey = keyCache.get(keyId);
  if (cachedKey) {
    return cachedKey;
  }

  try {
    const publicKey = await fetchPublicKey(keyId);
    if (publicKey) {
      keyCache.set(keyId, publicKey);
    }
    return publicKey;
  }
  catch (error) {
    console.error('Error fetching public key:', error);
    return null;
  }
}

/**
 * Fetches the public key from the keyId URL.
 * Handles different formats of public keys in ActivityPub implementations.
 *
 * @param {string} keyId - The key identifier URL
 * @returns {Promise<string|null>} The public key as a string, or null if fetching fails
 */
async function fetchPublicKey(keyId: string): Promise<string | null> {
  try {
    // Extract the actor URL from the keyId
    const url = new URL(keyId);
    const actorUrl = `${url.protocol}//${url.host}${url.pathname.split('#')[0]}`;

    // Fetch the actor object with proper Accept headers
    // TODO: find a better shared place to put the user agent identifier and use that variable here
    const response = await axios.get(actorUrl, {
      headers: {
        'Accept': 'application/activity+json, application/ld+json',
        'User-Agent': 'Pavillion ActivityPub Server',
      },
      timeout: 10000, // 10 second timeout
    });

    if (response.status !== 200) {
      console.error(`Failed to fetch actor from ${actorUrl}, status: ${response.status}`);
      return null;
    }

    const actor = response.data;

    // Handle both common key structures in ActivityPub implementations
    if (actor.publicKey && actor.publicKey.publicKeyPem) {
      return actor.publicKey.publicKeyPem;
    }

    if (actor.publicKey && typeof actor.publicKey === 'string') {
      // Some implementations provide direct URL to the key
      const keyResponse = await axios.get(actor.publicKey, {
        headers: {
          'Accept': 'application/activity+json, application/ld+json',
          'User-Agent': 'Pavillion ActivityPub Server',
        },
        timeout: 10000,
      });

      if (keyResponse.status === 200 && keyResponse.data.publicKeyPem) {
        return keyResponse.data.publicKeyPem;
      }
    }

    console.error(`Could not find public key in actor object from ${actorUrl}`);
    return null;
  }
  catch (error) {
    console.error('Error fetching public key:', error);
    return null;
  }
}

/**
 * Verifies if the activitypub actor has permission for the operation in the request.
 * Basic check to ensure the request actor matches the actor associated with the key.
 *
 * @param {string|null} requestActor - The actor identifier from the request
 * @param {string} keyId - The key identifier URL
 * @returns {Promise<boolean>} True if the actor has permission, false otherwise
 */
async function verifyActorPermission(requestActor: string|null, keyId: string): Promise<boolean> {
  if(!requestActor || !keyId) {
    return false;
  }

  const keyIdUrl = new URL(keyId);
  const actorUrl = `${keyIdUrl.protocol}//${keyIdUrl.host}${keyIdUrl.pathname.split('#')[0]}`;

  // Basic check - the request actor should match the actor associated with the key
  if (!requestActor.startsWith(actorUrl)) {
    console.warn(`Actor mismatch: request actor ${requestActor} does not match key actor ${actorUrl}`);
    return false;
  }

  return true;
}
