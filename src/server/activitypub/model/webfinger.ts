
class WebFingerResponse {
    subject: string;
    links: WebFingerLink[];

    constructor(orgName: string, domain: string) {
        this.subject = 'acct:' + orgName + '@' + domain;
        this.links = [ new WebFingerLink(orgName, domain) ];
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

    constructor(orgName: string, domain: string) {
        this.rel = 'self';
        this.type = 'application/activity+json';
        this.href = 'https://' + domain + '/o/' + orgName;
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
