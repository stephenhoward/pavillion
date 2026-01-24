class UserProfileResponse {
  id: string;
  type: string;
  preferredUsername: string;
  inbox: string;
  outbox: string;
  publicKey: string;

  constructor(urlName: string, domain: string, publicKey?: string) {
    this.id = 'https://' + domain + '/calendars/' + urlName;
    this.type = 'Organization';
    this.preferredUsername = urlName;
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
