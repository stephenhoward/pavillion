class UserProfileResponse {
    id: string;
    type: string;
    preferredUsername: string;
    inbox: string;
    outbox: string;

    constructor(preferredUsername: string, domain: string) {
        this.id = 'https://' + domain + '/users/' + preferredUsername;
        this.type = 'Person';
        this.preferredUsername = preferredUsername;
        this.inbox = 'https://' + domain + '/inbox/' + preferredUsername;
        this.outbox = 'https://' + domain + '/outbox/' + preferredUsername;
    }

    toObject(): Record<string, any> {
        return {
            id: this.id,
            type: this.type,
            preferredUsername: this.preferredUsername,
            inbox: this.inbox,
            outbox: this.outbox
        };
    }
}

export { UserProfileResponse }