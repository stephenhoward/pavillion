---
description: Guides for contributing to Pavillion — translating the interface, writing documentation, and changing the code, including how the application is put together and the rules that keep it coherent.
---

# For project contributors

These guides are for people who want to make Pavillion itself better — a translator bringing the interface to their community's language, an organizer who found a guide confusing and wants to fix it, a volunteer fixing a bug they hit on their own instance, a developer adding a feature their community needs.

You don't need to write code to contribute. Pick the path that matches what you want to do:

- **Translating?** Start with [Translating Pavillion](./translating).
- **Improving the guides?** Start with [Writing documentation](./writing-documentation).
- **Changing the code?** Read [Architecture](./architecture) first. It explains where code lives and the handful of rules that decide where *your* code should go. Most review feedback on first pull requests comes back to one of those rules. [Tech stack](./tech-stack) names what the project is built on, area by area, and why.

Whichever path you take, the [contributing guide](https://github.com/stephenhoward/pavillion/blob/main/docs/CONTRIBUTING.md) on GitHub covers setting up a development environment and the branch, commit and pull-request conventions.

## What's in this section

**Translating Pavillion** — adding a language, improving an existing translation, and checking your work in the running application.

**Writing documentation** — where the guides live, the voice they're written in, and how to preview a change before you open a pull request.

**Architecture** — the parts of the application (server, client, site, widget, shared code), how server domains talk to each other, how database entities relate to models, and where business logic belongs.

**Tech stack** — the framework, database, frontend, testing, federation, internationalization, storage and configuration choices, and the reasoning behind the ones that aren't obvious.

## What's not here

- **Setting up a development environment and opening a pull request.** That is in the [contributing guide](https://github.com/stephenhoward/pavillion/blob/main/docs/CONTRIBUTING.md).
- **Running a Pavillion server.** That belongs to the [administrator guides](/guides/instance-administrators/).
- **The ActivityPub specification.** Pavillion's federation code is easier to follow if you know the protocol, but these guides don't teach it.
