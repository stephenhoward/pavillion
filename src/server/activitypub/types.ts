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
