---
description: Guides for contributing code to Pavillion — how the application is put together, what it is built on, and the rules that keep the codebase coherent.
---

# For contributing developers

These guides are for people who want to change Pavillion itself — a volunteer fixing a bug they hit on their own instance, a developer adding a feature their community needs, a translator who wants to see their language end to end, anyone opening a pull request against the project.

Two ways to read this section:

- **New to the codebase?** Read [Architecture](./architecture) first. It explains where code lives and the handful of rules that decide where *your* code should go. Most review feedback on first pull requests comes back to one of those rules.
- **Looking for a specific tool?** [Tech stack](./tech-stack) names what the project is built on, area by area, and why.

To get a development environment running, and for the branch, commit and pull-request conventions, start with the [contributing guide](https://github.com/stephenhoward/pavillion/blob/main/docs/CONTRIBUTING.md) on GitHub.

## What's in this section

**Architecture** — the parts of the application (server, client, site, widget, shared code), how server domains talk to each other, how database entities relate to models, and where business logic belongs.

**Tech stack** — the framework, database, frontend, testing, federation, internationalization, storage and configuration choices, and the reasoning behind the ones that aren't obvious.

## What's not here

- **Setting up a development environment and opening a pull request.** That is in the [contributing guide](https://github.com/stephenhoward/pavillion/blob/main/docs/CONTRIBUTING.md).
- **Adding a language.** The [internationalization guide](https://github.com/stephenhoward/pavillion/blob/main/docs/internationalization.md) covers registering a language and where translation files live.
- **Running a Pavillion server.** That belongs to the [administrator guides](/guides/instance-administrators/).
- **The ActivityPub specification.** Pavillion's federation code is easier to follow if you know the protocol, but these guides don't teach it.
