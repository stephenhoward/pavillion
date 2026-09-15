class UserProfileResponse {
  id: string;
  type: string;
  preferredUsername: string;
  /**
   * The calendar's human-facing public page, in the root form DEC-018 gave our
   * own URLs. This is the property peers read to link back to us instead of
   * guessing our route shape from their own — the mirror of what we read from
   * their actor documents. It is deliberately the canonical root URL rather
   * than the `/view/` spelling that only 301s to it, because on our own domain
   * we know our own version.
   */
  url: string;
  inbox: string;
  outbox: string;
  publicKey: string;

  constructor(urlName: string, domain: string, publicKey?: string) {
    this.id = 'https://' + domain + '/calendars/' + urlName;
    this.type = 'Organization';
    this.preferredUsername = urlName;
    this.url = 'https://' + domain + '/' + urlName;
    this.inbox = 'https://' + domain + '/calendars/' + urlName + '/inbox';
    this.outbox = 'https://' + domain + '/calendars/' + urlName + '/outbox';
    this.publicKey = publicKey || '';
  }

  toObject(): Record<string, any> {
    return {
      '@context': ['https://www.w3.org/ns/activitystreams'],
      id: this.id,
      type: this.type,
      preferredUsername: this.preferredUsername,
      url: this.url,
      inbox: this.inbox,
      outbox: this.outbox,
      publicKey: {
        id: this.id + '#main-key',
        owner: this.id,
        publicKeyPem: this.publicKey,
      },
    };
  }
}

export { UserProfileResponse };
