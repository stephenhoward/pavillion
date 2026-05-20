---
description: Understand federation from the administrator's seat — what your instance is signing and sending, what it accepts, and the boundary between protocol and policy.
---

# How federation works, for admins

> Status: placeholder. This guide will be written before launch.

Calendar owners can use federation without thinking about how it works. Administrators can't. This guide is the admin-eye view: what your server is signing and sending, what it's accepting, where the protocol stops and your policy starts.

## Planned scope

- The mental model: your instance is an actor in a network of other actors, identified by domain. Domain is identity — you cannot change it without breaking every existing federation relationship
- What the worker container actually does: signs outbound activities (Follow, Create, Update, Announce, Delete) with your instance's private key, delivers them to other instances' inboxes
- What inbound looks like: other instances POST to your inbox endpoint with their signed activities; the app verifies signatures, applies them to the database
- The pieces of federation behavior that are protocol (you can't change them) vs. the pieces that are your policy: who you accept activities from, what you do with them, when you reject
- Public-key cryptography for actors, briefly. You don't need to be able to verify a signature by hand; you do need to know what happens if your instance's private key leaks
- The line between [federation policy](./federation-policy) (whose activities you accept), [moderation boundaries](./moderation-boundaries) (what you do about local content), and [federation incidents](./federation-incidents) (what you do when something crosses instance lines)
