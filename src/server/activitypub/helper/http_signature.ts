import { Request, Response, NextFunction } from 'express';
import httpSignature from 'http-signature';
import axios from 'axios';
import { URL } from 'url';
import { ClientRequest } from 'http';

export async function verifyHttpSignature(req: Request, res: Response, next: NextFunction) {
    try {
        // Parse the signature header
        const parsedSignature = httpSignature.parseRequest(req as unknown as ClientRequest);
        if ( ! parsedSignature ) {
            return res.status(401).json({error: ' Signature required'});
        }

        if (!parsedSignature.params.keyId ) {
            return res.status(401).json({ error: 'Invalid signature format' });
        }

        // Fetch the public key from the keyId URL
        const publicKey = await fetchPublicKey(parsedSignature.params.keyId);
        if (!publicKey) {
            return res.status(401).json({ error: 'Could not retrieve public key' });
        }

        // Verify the signature
        if (! httpSignature.verifySignature(parsedSignature, publicKey) ) {
            return res.status(401).json({ error: 'Invalid signature' });
        }

        // Check if the actor has permission for this operation
        if (! verifyActorPermission(req.body.actor, parsedSignature) ) {
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
 * Fetch the public key from the keyId URL
 */
async function fetchPublicKey(keyId: string): Promise<string | null> {
    try {
        // Extract the actor URL from the keyId
        const url = new URL(keyId);
        const actorUrl = `${url.protocol}//${url.host}${url.pathname.split('#')[0]}`;

        // Fetch the actor object
        const response = await axios.get(actorUrl, {
            headers: {
                'Accept': 'application/activity+json, application/ld+json'
            }
        });

        if (response.status !== 200) {
            console.error(`Failed to fetch actor from ${actorUrl}, status: ${response.status}`);
            return null;
        }

        const actor = response.data;

        if (actor.publicKey && actor.publicKey.publicKeyPem) {
            return actor.publicKey.publicKeyPem;
        }

        console.error(`Could not find public key in actor object from ${actorUrl}`);
        return null;
    } catch (error) {
        console.error('Error fetching public key:', error);
        return null;
    }
}

/**
 * Check if the actor has permission for the operation in the request
 */
function verifyActorPermission(requestActor: string|null, signature: Record<string,any>): boolean {
    if(!requestActor || !signature.keyId) {
        return false;
    }

    const keyIdUrl = new URL(signature.keyId);
    const actorUrl = `${keyIdUrl.protocol}//${keyIdUrl.host}${keyIdUrl.pathname.split('#')[0]}`;

    // Check if actor matches the actor URL from the signature
    if (!requestActor.startsWith(actorUrl)) {
        return false;
    }

    return true;
}