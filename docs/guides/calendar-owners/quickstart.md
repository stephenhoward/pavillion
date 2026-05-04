# Quickstart: from login to a published event

This is the on-ramp. It takes you from "I just got an account on a Pavillion instance" to "I have a published calendar with one real event on it that I can share with a friend." It's linear and opinionated — no branching, no choices to make. About ten to fifteen minutes of reading and clicking.

Everything else in the calendar-owner guides is reference material you can come back to. This page is sequential.

## What you'll have when you're done

A working calendar at a public URL, with one event on it, that you can paste into a chat or an email and have a friend look at.

## Before you start

You need an account on a Pavillion instance. Sign-up varies by instance: some accept open applications through the site, others run on invitation only — your local arts council, neighborhood mesh, or housing co-op decides which posture fits the community. Either way, signing up is the part where you provide an email address you control, confirm it through a link, and choose a password. By the time you're reading this, that's done and you have credentials in hand.

Throughout this guide, "your instance" means the Pavillion server your account lives on. The URLs you see will use that instance's domain. We'll write `your-instance.example` as a stand-in.

## Step 1: Log in

Go to `https://your-instance.example/` and sign in with the email address and password you set up. The first thing you'll land on is your feed — the activity stream for any calendars you eventually follow. It will be empty for now. That's expected.

You don't have a calendar yet. The next step is to make one.

## Step 2: Create your calendar

Open the calendars list (the calendar icon in the navigation) and choose **New calendar**.

You'll be asked for two things:

- **Calendar title** — the human-readable name. "Westside Community Garden Events," "Riverbend Folk Series," "Maplewood Mutual Aid Calendar." Whatever your community will recognize.
- **URL handle** — the short, URL-safe slug that becomes part of your calendar's web address. Pavillion auto-fills this from the title (lowercased, hyphenated, trimmed), and you can edit it before submitting. The full handle takes the form `your-handle@your-instance.example` — the `@` shape matters because that's how other Pavillion calendars (on this instance or any other) will find and follow you.

> **A note on choosing a handle.** The handle is hard to change after the fact — once people have linked to it, bookmarked it, or pasted it into an email, changes break those links. Pick something short, durable, and tied to the community rather than to a moment in time. `riverbend-folk` ages better than `riverbend-2026-season`.

Submit the form. You'll land on your new calendar's editor page. It's empty. We'll fix that.

## Step 3: Round out your calendar's identity

The two things you just entered are the bare minimum to create the calendar. Before publishing an event, fill in the rest of the basics:

1. From your calendar's page, open **Settings**.
2. Add a **description**. One or two sentences: who this calendar is for and what kinds of events it lists. Visitors to your public page will read this. So will other calendar owners deciding whether to follow you.
3. The **primary language** is set to your account's language by default. Most calendars run in one language — leave it as is. If you'll publish in more than one, you can add additional languages here too; each translatable field (titles, descriptions) becomes a tabbed surface across those languages.

Settings save as you go — there's no separate "save" button on this page. Move on when you're satisfied.

> **A note on description.** Treat the description as something a stranger reads before deciding to follow your calendar. "Events organized by and for the Westside community garden — workdays, harvests, potlucks, and quarterly meetings" tells a visitor whether they're in the right place. "All events" tells them nothing.

## Step 4: Add your first event

Back on your calendar's page, look for the button to add an event (it lives near the events list). The event editor opens as a full-page form. We'll go top to bottom.

**Event details.** Give the event a title. Add a description — a short paragraph is fine, more if there's logistics worth spelling out. If accessibility info is relevant (wheelchair access, ASL interpretation, scent-free space), there's a dedicated field for it; visitors look for that information specifically and it shouldn't be buried in the description.

**Location.** Click **Add location**. The location picker opens. You probably don't have any places saved yet, so choose **Create new place**, fill in the name and address, and confirm. The place is now reusable — the next event you create at the same venue will pick it from a list rather than re-typing the address.

> **A note on places.** A "place" in Pavillion is its own thing — separate from the events that reference it. The address is stored once, on the place. Events point at the place. So when the venue changes its name or you correct a typo in the address, you fix it once and every event there is updated.

**External link** (optional). If the event has a registration page, ticket link, or external info page elsewhere, paste the URL here and pick the prompt that matches it ("More info," "Tickets," "RSVP"). Skip this if there's nothing external to link to.

**Event image** (optional). Upload one if you have it. If you don't, skip — the calendar's default event image will fill in.

**Categories.** Pick at least one. If your calendar is brand new, no categories exist yet — you'll need to create one. From the category section, add a category like "Community gathering" or "Workday" or whatever fits. You can add more later.

> **A note on categories.** Categories are how visitors filter your public page (`Show only Workdays`) and how your events get matched up when other calendars repost them. A small, durable vocabulary works better than a long list of one-off labels — "Concert" earns its keep over many events; "Tuesday night jazz quartet" doesn't.

**Series.** Skip for this first event. A series is for grouping multiple distinct events under one named program (a summer concert series, a fall lecture series). One-off events don't need it.

**Date & time.** Set the start and end. For your first event, leave it as a single occurrence — no recurrence rule. If your event repeats on a schedule, recurrence handles that, but it's easier to learn the editor on a one-off first.

When the form is filled in, click **Save Changes** in the page header. The event is now published — Pavillion doesn't have a draft state. If you change your mind, you can edit or cancel it from the events list.

## Step 5: See what visitors see

Your event is live. Now look at your public page.

Open a new browser tab and go to `https://your-instance.example/view/your-handle`, replacing `your-handle` with the URL handle you chose in Step 2. (You can also find this URL on the calendar page — there's a link to "view public page" or similar.)

What you're looking at is what anyone on the internet sees. No login required. Your event should be there, with the place, the date, the description, and the category you chose. Click into the event to see its detail page — that's the URL you'd share for a single event.

Paste your calendar's URL into a chat with a friend. Have them open it. Ask whether the event makes sense to them as someone who's never seen it before. That feedback — from a fresh pair of eyes who is the audience, not the organizer — is more useful than any checklist.

## What next

You have a calendar. You have one event on it. You have a URL you can share. The rest of the calendar-owner guides cover what comes after:

- **More events.** Add the rest of what's coming up. Events that repeat (weekly meetings, monthly meetups) — see the recurring-events guide. Series of distinct events under a program name — see the series guide.
- **More structure.** A bigger event list benefits from a richer set of categories and a tidied-up list of places — those have their own guides.
- **More people.** If you're not running this alone, invite editors so others can publish too — the editors guide covers that.
- **More reach.** Find other calendars in your community to follow, and decide whether to repost their events onto yours — the follow-and-repost guide covers that. If you're migrating from an existing calendar (Google Calendar, Nextcloud, a WordPress plugin, an existing Gancio or Mobilizon calendar), the ICS-import guide shows how to bring that history in.

You don't have to do any of those today. The calendar you just made is enough to start with.
