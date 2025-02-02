
class WebFingerResponse {
    subject: string;
    links: WebFingerLink[];

    constructor(username: string, domain: string) {
        this.subject = 'acct:' + username + '@' + domain;
        this.links = [ new WebFingerLink(username, domain) ];
    }

    toObject(): Record<string, any> {
        return {
            subject: this.subject,
            links: this.links.map( (link) => link.toObject() )
        };
    }
}

class WebFingerLink {
    rel: string;
    type: string;
    href: string;

    constructor(username: string, domain: string) {
        this.rel = 'self';
        this.type = 'application/activity+json';
        this.href = 'https://' + domain + '/users/' + username;
    }

    toObject(): Record<string, any> {
        return {
            rel: this.rel,
            type: this.type,
            href: this.href
        };
    }
}

export { WebFingerResponse }
