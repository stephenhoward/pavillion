# Security Refreshes of a Released Image

This guide covers what happens when a security fix lands in the operating
system packages inside a released Pavillion container image, and what you
need to do about it. It is for the people running an instance. The short
version: a refreshed image arrives as a new patch release, and installing
it is an ordinary upgrade with nothing to migrate.

## A published tag never changes

Once a version such as `v0.8.0` has been published, the image behind that
tag is never rebuilt. If `v0.8.0` named one set of bits in October and a
different set in November, pinning to a version would mean nothing, and
"which version are you running?" would have no answer during an incident.

When a released image needs a security refresh, the maintainers cut a new
patch release — `v0.8.1` — from the same source code as the previous one.
The only thing that changes is the operating system packages in the image.
It goes through the same release pipeline as every other release, so it is
tested and published the same way.

## How you learn a refreshed image exists

The same way you learn about any release: the
[releases page](https://github.com/stephenhoward/pavillion/releases). A
security-only refresh says so in its release notes, so you can tell it
apart from a release that changes the application.

To be told rather than having to look, watch the repository for releases
on GitHub (**Watch → Custom → Releases**), or subscribe to the
[releases feed](https://github.com/stephenhoward/pavillion/releases.atom).

## Installing it

A security-only refresh is a normal upgrade. Run `bin/deploy.sh` as
described in the [upgrading guide](upgrading.md); it pulls the new image
and restarts the containers.

If you pin `PAVILLION_IMAGE_TAG` to a specific version in `.env`, change
it to the new version first. If you run the default `latest` tag, there is
nothing to change.

Because the application code is identical to the previous release:

- No database migrations run. There is nothing new for them to do.
- No configuration changes are needed, and no new secrets are introduced.
- Nothing about how your instance behaves changes. Calendar owners and
  visitors will not notice.

The pre-upgrade backup the upgrading guide recommends is still a good
habit, but it is protecting you against application changes this release
does not have.

## What the findings mean, and what they do not

Pavillion's image is scanned every week, and the results are posted
publicly to an issue labelled
[`health-report`](https://github.com/stephenhoward/pavillion/issues?q=label%3Ahealth-report).
That report lists vulnerabilities in the Debian packages the image is
built on — the C library, compression libraries, scripting runtimes the
base image happens to include — alongside anything found in Pavillion's
own dependencies.

**An operating-system package finding is not a vulnerability in
Pavillion.** It means a package present in the image has a known defect.
Whether that defect is reachable depends on whether the container ever
runs the affected code, and for a large share of base-image findings it
does not: the package is there because the base image includes it, and
nothing Pavillion does calls into it.

What that means for you:

- A finding on the report is not, by itself, a reason to act. The
  maintainers read every one and decide whether it warrants a refreshed
  image.
- A security-only patch release means they decided it did. Take it at
  your next convenient restart. Because it carries no application
  changes, it is the lowest-risk upgrade you will ever install.
- If a release ever needs faster action than that, its release notes will
  say so plainly rather than leaving you to infer it from the scan.

## What does not get a patch release

Not every finding produces a release. Two kinds never do on their own:

- **Findings with no upstream fix.** If Debian has not published a fixed
  package, rebuilding the image changes nothing. These are assessed for
  whether they are reachable in the container and tracked by the
  maintainers until a fix appears or the finding goes away.
- **Findings in packages that are present but never executed.** A
  vulnerable binary that nothing in the container runs is a defect in the
  image's inventory, not in what the image does. These are picked up by
  the next regular release, which rebuilds the image anyway.

Which findings cross the line is a judgement call made each week, not a
severity threshold. A HIGH-rated finding in a package Pavillion never
touches can wait; a lower-rated one in a library on the request path may
not. The decision and its reasoning stay with the maintainers; the public
report records that a finding was assessed, not how.

## Related documentation

- [Upgrading guide](upgrading.md) — the `bin/deploy.sh` flow and rollback
- [Deployment guide](deployment.md) — pinning `PAVILLION_IMAGE_TAG`
