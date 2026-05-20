---
description: Decide who your Pavillion instance federates with — allowlist, blocklist, and the harder question of what to do when another admin asks you to defederate from somewhere.
---

# Federation policy

> Status: placeholder. This guide will be written before launch.

The hardest social judgment in this section. Federation is by default open — your instance will accept activity from any other Pavillion or other ActivityPub event platform that asks. Most admins want some control over that. The shape of the control is a choice, and the consequences of getting it wrong cut both ways.

## Planned scope

- The two postures: blocklist (open-by-default, refuse specific instances by name) and allowlist (closed-by-default, accept only specific instances by name). Hybrid postures and when they make sense
- When a blocklist is the right call: most community instances, most regional instances, anywhere "we federate with the network and handle bad actors by exception"
- When an allowlist is the right call: org-internal instances that federate only with sister instances, high-risk or sensitive communities, instances that want a curated network experience
- The mechanics: where the lists live, what blocking actually does (refuses inbound activities, doesn't send outbound, displays accordingly), how to add and remove entries
- Inbound and outbound asymmetry — you can refuse to accept from somewhere and they can still receive from you, unless you also stop publishing federated copies of public events
- The conversation that comes up sooner than you expect: another admin asks you to defederate from a third instance. How to handle it without becoming a clearinghouse. What to ask them, what counts as evidence, what isn't your job to evaluate
- Documenting your policy publicly. A "who we federate with and why" page does more for trust than a long CoC does
