import express, { Request, RequestHandler } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    /**
     * The request body exactly as received, captured by
     * {@link activityJsonBodyParser}. `verifyHttpSignature` hashes these bytes
     * for the Digest check: a re-serialization of the parsed `body` need not
     * match what the sender hashed.
     */
    rawBody?: Buffer;
  }
}

/**
 * Upper bound on an ActivityPub request body, in bytes: 100 KiB, the
 * express.json default, stated so the bound is visible where it applies. An
 * embedded Event with several languages of content and a few attachments is a
 * few tens of KiB; the 1 MiB cap on outbound fetches (`remote-fetch.ts`) cites
 * this number. A larger body is refused with 413 before it is buffered whole.
 */
export const INBOX_BODY_MAX_BYTES = 102_400;

/**
 * JSON body parser for the ActivityPub routers, declared once so the content
 * types, the size limit and the raw-body capture cannot drift between them.
 *
 * ActivityPub names both activity+json and ld+json with the ActivityStreams
 * profile as request types a server must accept; type matching ignores the
 * profile parameter, so ld+json is parsed with or without it.
 *
 * `verify` runs on the wire bytes before parsing and stashes them as
 * `req.rawBody` for the Digest check in `verifyHttpSignature`.
 */
export function activityJsonBodyParser(): RequestHandler {
  return express.json({
    type: ['application/json', 'application/activity+json', 'application/ld+json'],
    limit: INBOX_BODY_MAX_BYTES,
    verify: (req, _res, buf) => {
      (req as Request).rawBody = buf;
    },
  });
}
