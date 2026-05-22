---
description: Verify that your Pavillion instance can federate — the two-instance docker-compose setup, the smoke tests, and the diagnostic loop when something is silent.
---

# Testing federation

> Status: placeholder. This guide will be written before launch.

Federation is the part of the install that's easiest to get wrong without noticing — the app comes up green, the calendar renders, and nothing federates because the worker can't reach the network, or your TLS cert isn't trusted, or your domain doesn't resolve from outside your network. This guide is the diagnostic loop.

## Planned scope

- The two-instance docker-compose harness for testing federation locally — what it spins up, how to use it, what it does and doesn't catch
- The smoke test on a new production instance: follow a known federating Pavillion, confirm the follow accept comes back, confirm at least one shared event arrives
- The reverse smoke test: have a known instance follow you, confirm they receive a Follow accept, confirm they receive a Create when you publish
- The diagnostic loop when federation looks silent: is the worker container running, are outbound activities being signed (worker logs), are they being POSTed (network), are they being received (the other side's logs if you can see them), are signatures verifying
- Common failure modes: TLS cert not trusted by the other instance, clock skew breaking signature verification, the other instance has defederated yours, your domain resolves from inside your network but not from outside
- The "I think I'm being blocked by a specific instance" diagnostic — usually true, sometimes a misconfiguration on your end
