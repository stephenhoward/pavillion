import { calendarPath } from '@/common/routing/public-paths';

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
   *
   * The path comes from `calendarPath`, the shared declaration of that shape,
   * with this instance's origin prepended the way `CalendarService.withPublicUrl`
   * and `EditorNotificationEmail` compose theirs. The three sibling URIs here
   * address the `/calendars/:urlName/...` AP-protocol namespace, which that
   * module does not model; `url` is the one field of the four that is a public
   * page. Peers cache this value (`calendar_actor.page_url`) on machines we do
   * not administer, so it is the last field in the product that should be
   * spelled by hand.
   *
   * Built unconditionally from the url name, and the reserved list is
   * deliberately NOT consulted: DEC-018 rule 4 says reservation governs
   * *claiming* a name, never *resolving* one, and `getCalendarByName` gates on
   * `CALENDAR_URL_NAME_RE` alone. So a calendar that predates a reservation —
   * one named `admin`, say — keeps its actor document, WebFinger response and
   * inbox, but the `url` advertised here is shadowed by the server-owned
   * segment and resolves to our admin app instead of its page. Same origin, so
   * the cost is misdirection rather than a security boundary, and the fix is
   * operational: the startup reserved-name collision report is the operator's
   * signal to rename the calendar deliberately.
   */
  url: string;
  inbox: string;
  outbox: string;
  publicKey: string;

  constructor(urlName: string, domain: string, publicKey?: string) {
    this.id = 'https://' + domain + '/calendars/' + urlName;
    this.type = 'Organization';
    this.preferredUsername = urlName;
    this.url = `https://${domain}${calendarPath(urlName)}`;
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
