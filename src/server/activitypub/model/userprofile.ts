class UserProfileResponse {
  id: string;
  type: string;
  preferredUsername: string;
  inbox: string;
  outbox: string;
  publicKey: string;

  constructor(urlName: string, domain: string) {
    this.id = 'https://' + domain + '/o/' + urlName;
    this.type = 'Organization';
    this.preferredUsername = urlName;
    this.inbox = 'https://' + domain + '/o/' + urlName + '/inbox';
    this.outbox = 'https://' + domain + '/o/' + urlName + '/outbox';
    // TODO provide public key in profile response:
    this.publicKey = '';
  }

  toObject(): Record<string, any> {
    return {
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
