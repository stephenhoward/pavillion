# Pavillion — mission and values

> This is the reference statement for everyone working on Pavillion, human or agent.
> When a piece of work, a review, or a ranking decision conflicts with something
> here, this document wins unless a recorded decision says otherwise. Recorded
> decisions are in [the product decision log](decisions.md).

## Mission

Pavillion is a federated events calendar. It gives organizations an easy way to
publish their own events to the public, and makes it simple to aggregate events from
many sources into community calendars curated by cities, chambers of commerce,
tourism boards, and community organizations.

It exists to improve the prosperity and wellbeing of local communities by helping
people find more connection with the places they live. It is infrastructure for a
community, not a product for an audience.

Calendars are first-class ActivityPub actors. That is the architectural expression of
the mission: a calendar is a participant in a network, not a page on a website.

## Who it is for

- **Event organizers** — organizations, nonprofits, businesses and individuals who
  publish their own events. Pavillion's first loyalty is to them: a network with no
  organizers has nothing to aggregate.
- **Community curators** — cities, chambers, tourism boards, libraries and similar
  bodies that assemble community calendars from many organizers' calendars. They are often also organizers themselves. We exist to make their job of collecting events for the community easier.
- **Instance operators** — self-hosters of widely varying technical skill who run a
  Pavillion server for their community. Without them, the community's events remain fragmented across many platforms.
- **The public** — people looking for something to do. They need no account and are
  never asked for one. Making the platform vibrant and event-filled enriches their lives.

## Values

Each value states what we will do and what we will not trade away. They are listed
in the order we resolve conflicts between them.

### Accessibility

Pavillion must be usable by everyone in a community, not only the technically
confident or the English-speaking.

- Multilingual out of the box: interface and content both, with translation tools
  for shared content.
- Usable with screen readers and assistive technology. A feature that fails
  assistive technology is not shipped.
- Content structures that encourage organizers to describe the accessibility of their
  own events.
- **Works on a phone.** For many organizers and much of the public, a phone is their
  primary or only computer. Every public and owner-facing surface must be usable on a small screen and a slow connection, in a browser, without installing anything.
  Desktop is a larger screen, not a different product.
- **Operational accessibility over cleverness.** It must work out of the box for a
  non-technical operator. A feature that only works when configured correctly by an
  expert has not shipped.

### Autonomy

Communities control their own infrastructure and their own data.

- Open source under the Mozilla Public License 2.0.
- No centralized service. Each instance decides what it hosts and whom it federates
  with.
- **Privacy-first public access.** Anyone can view public events without an account,
  without tracking, and without data collection. Accounts exist only for the people
  who organize and steward calendars (DEC-004).
- Aggregation happens through federation. A community calendar is built by
  following other calendars in the network, not by scraping or importing closed
  platforms (DEC-011).

### Community

The point of the project, in its development and in its use, is helping people find
more connection with their communities.

- Pavillion prioritizes community benefit over revenue extraction. It is built for
  local economic development in the "economic gardening" sense: enhancing existing organizations and businesses in the community before attracting new ones.
- Funding is voluntary and instance-inward: calendar owners support the operator who hosts them, in the public-radio model (DEC-007). No core feature is gated on
  payment.
- **Sustainability and participation are balanced, not traded.** An operator may
  offer everything free, but not every operator can afford to. A fixed price keeps
  an instance running but can price some calendar owners out of features they
  want. Pavillion supports the full range, free, pay-what-you-can and fixed, and
  leaves the choice to each operator, so that an instance can stay solvent without
  shutting out the owner with little money.
- Features that maintain ongoing integrations with non-federated systems are the
  extended, supporter-funded tier. In-network features are free (DEC-011).

### Flexibility

Organizers should not have to choose between Pavillion and the places they already
publish.

- Embeddable calendars for an organization's own website.
- Export and one-time import in standard formats, so moving a calendar in is easy and moving it out is never blocked.

## How we build

Operating commitments that follow from the values. Reviewers hold work to these.

- **Conservative defaults.** Defer complexity to an articulated trigger rather than
  building for it now. Build for the observed user, not the imagined scale.
- **No silent failures.** A thing that breaks quietly on a small instance is worse
  than a thing that refuses loudly.
- **Documentation is a product surface.** If an operator cannot succeed from the
  docs, the feature is not done.
- **Supply before aggregation.** Work that helps organizers publish ranks ahead of
  work that helps curators aggregate, until there is something to aggregate.
- **Every recorded decision stays recorded.** Product decisions live in the
  decision log and are cited, not re-litigated, in work items and reviews.

## Position in the ecosystem

Pavillion sits alongside Mastodon, Lemmy, PeerTube and Mobilizon in the fediverse.
Mobilizon and Gancio are the nearest peers by subject. PeerTube is the closest
structural analog: it shares the two-actor model (accounts plus channels, as
Pavillion has users plus calendars).
