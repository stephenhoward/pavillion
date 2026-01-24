
class WebFingerResponse {
  subject: string;
  links: WebFingerLink[];

  constructor(name: string, domain: string, type: 'user' | 'calendar' = 'calendar') {
    if (type === 'user') {
      this.subject = 'acct:@' + name + '@' + domain;
      this.links = [ new WebFingerLink(name, domain, 'user') ];
    }
    else {
      this.subject = 'acct:' + name + '@' + domain;
      this.links = [ new WebFingerLink(name, domain, 'calendar') ];
    }
  }

  toObject(): Record<string, any> {
    return {
      subject: this.subject,
      links: this.links.map( (link) => link.toObject() ),
    };
  }
}

class WebFingerLink {
  rel: string;
  type: string;
  href: string;

  constructor(name: string, domain: string, actorType: 'user' | 'calendar' = 'calendar') {
    this.rel = 'self';
    this.type = 'application/activity+json';

    if (actorType === 'user') {
      this.href = 'https://' + domain + '/users/' + name;
    }
    else {
      this.href = 'https://' + domain + '/calendars/' + name;
    }
  }

  toObject(): Record<string, any> {
    return {
      rel: this.rel,
      type: this.type,
      href: this.href,
    };
  }
}

export { WebFingerResponse };
