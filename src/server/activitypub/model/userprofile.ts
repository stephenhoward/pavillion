class UserProfileResponse {
    id: string;
    type: string;
    preferredUsername: string;
    inbox: string;
    outbox: string;
    publicKey: string;

    constructor(preferredUsername: string, domain: string) {
        this.id = 'https://' + domain + '/users/' + preferredUsername;
        this.type = 'Person';
        this.preferredUsername = preferredUsername;
        this.inbox = 'https://' + domain + '/users/' + preferredUsername + '/inbox';
        this.outbox = 'https://' + domain + '/users/' + preferredUsername + '/outbox';
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
                publicKeyPem: this.publicKey
            }
        };
    }
}

export { UserProfileResponse }