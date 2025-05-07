# Pavillion

Pavillion is a federated events calendar. Using federation it aims to provide an easy way for organizatioins to share their own events with the public, and also make it simple to share and aggregate events from across multiple sources to make community calendars that can be curated by cities, chambers of commerce, tourism boards, or other community-oriented organizations.

## Project Principles

### Accessibility

- Multilingual out of the box. Providing translation tools for both the software interfaces and the content shared.
- Allowing for content to be translated into multiple languages to support multilingual communities.
- Designing the software to be usable with screen readers and other accessibility technology
- Providing structures in the content that encourage event hosts to describe the accessiblity of their events to those who attend them.

### Autonomy

- Open Source under the [Mozilla Public License 2.0](https://mozilla.org/MPL/2.0/)
- No centralized service
- No account required for the public to view events.
- Different pavillion servers can determine what content they wish to host.

### Flexibility

- Provide an embeddable version of a calendar for easy inclusion in an organization's website.
- Provide syncing/exporting to popular platforms (eg, Facebook) to reduce the effort of sharing events far and wide.

### Community

The goal of the project, both in it's open source development, and it's end use, is to find help people find more connections with their communities.

## Running Pavillion for Development

At the moment you can run Pavillion on node on your machine directly. Containerized development is coming.

    npm install
    npm run dev

This will set up the pavillion service on port 3000, and an asset serving service under Vite on port 5173. This setup hot-reloads both the server and client code.

## Tests

Tests are run under the vitest framework. You can either `npx vitest` or `npm run test`. I am working towards a goal of maintaining 80% or better unit test coverage.

## Formatting

We have an eslint config. Use `npm run lint` or `npm run lint:fix` to check formatting and other code conventions.

## License

Pavillion is licensed under the [Mozilla Public License 2.0](https://mozilla.org/MPL/2.0/). This means:

- You can use, modify, and distribute the software
- If you modify Pavillion's files, those modifications must be released under MPL-2.0
- You must make the source code available when you distribute the software
