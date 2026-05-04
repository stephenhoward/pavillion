# Migrate from another calendar via ICS import

> Status: stub. Full guide coming before launch.

Most new calendar owners arrive with events already living somewhere — a Google Calendar, a Nextcloud instance, a WordPress events plugin, a Gancio or Mobilizon calendar. This guide covers the path for getting that history into Pavillion using ICS, the standard calendar-data format that almost every calendar tool can export.

## What ICS import does (and doesn't) do today

The shape of the v1 import: you point Pavillion at an ICS feed, prove you control the source via a DNS TXT record, and pull events on demand. No background polling. No hosted-provider OAuth. Those will arrive later as advanced sync features.

## Add an import source

The mechanics of pointing Pavillion at an ICS feed.

## Verify ownership via DNS TXT record

Why the verification exists, where to add the record, and what to do if you don't control DNS for the source domain.

## Run a "Sync now" pull

The manual sync. What happens during the pull, what gets created, what gets skipped.

## What happens on subsequent syncs

How the import handles events that have changed at the source, events that have been deleted, and events you've edited locally after import.

## Common migration foot-guns

The places imports most often go sideways — timezone drift, recurrence-rule fidelity, place deduplication.

## What's coming later

The advanced sync features that aren't in v1: background polling, hosted-provider OAuth (Google, Outlook, iCloud), mirror mode with ongoing source precedence.
