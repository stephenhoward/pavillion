---
description: Share your Pavillion calendar's public URL and federation handle — what each one is for, what visitors see, and how to share them on the web or in a chat.
---

# Share your public calendar URL

Once your calendar has events on it , the next job is getting it in front of the people it's for. This guide covers the two things you hand out to do that: the **public URL**, which anyone can open in a browser, and the **federation handle**, which other calendar owners use to follow yours.

## The public URL versus the address you work at

Your calendar's public address is different from where you log in to manage it:

- **Your public URL** — `your-instance.example/your-handle`. Anyone can open it, with no account and no login. This is the one to share. Your handle is the short name you picked when you created the calendar. The handle can't be changed after creation, so the URL can't either. [Customize your calendar's identity](./identity#the-url-handle) has the advice on picking one that ages well.
- **The address you work at** — `your-instance.example/`, the screen where you and your editors add events. It only works for people signed in with access to your calendar. Anyone else who opens it gets a login page, not your events.

## Finding your public URL

To find your public URL, open your calendar in Pavillion. On the screen where you add events, the public URL appears as a link just under the calendar's name. Click it to open your public page in a new tab, or copy it from there.

### What visitors see

Opening your public URL shows what anyone on the internet sees:

- Your calendar's **name** and **description** at the top, in the visitor's language if you've translated them.
- Your **upcoming events**, as a list grouped by day. The list covers the window you set as your calendar's [default date filter](./identity#the-default-date-filter), two weeks unless you've changed it.
- A **search box**, **category filters**, and a **date control**, so visitors can narrow the list or look further ahead.
- A choice of **list, week, or month view**.

Every event has its own page with the full details: place, time, description, accessibility notes, and an option to add it to the visitor's own calendar app. Visitors don't need an account for any of this, and Pavillion doesn't track them.

Your public page also shows events you've reposted from other calendars, and each one's page links back to the calendar it came from.

### Links to one event, a series, or a filtered view

The calendar's address isn't the only thing you can share. Every page under it has its own address, and you can copy it from the browser's address bar:

- **One event** — `your-instance.example/your-handle/events/…`. Share this when you're promoting a specific thing: the spring plant sale, not the whole garden calendar.
- **A series** — `your-instance.example/your-handle/series/summer-concerts`. See [Group related events into a series](./series).
- **A filtered view** — after a visitor (or you) picks a category, types a search, or switches to the month view, the address bar updates to match. Copy it then, and the person you send it to lands on the same view. A neighborhood calendar can hand the youth soccer league a link that opens on *Sports* only.

**Share an event link when you want a preview.** When you paste an event's link into a chat app or social post, the preview card shows the event's title, description, and image. A link to the calendar page itself previews as a plain link — no calendar name, no description, no image. For a group chat where the preview is most of what people see, a link to your next event usually does more than a link to the whole calendar.

### Addresses in other languages

If your instance offers more than one language, every public page has a version for each one. Put the language code in front of the handle: `your-instance.example/fr/your-handle` for French, `your-instance.example/es/your-handle` for Spanish. English, Pavillion's default, has no prefix. Use the prefixed version when you're writing *to* a particular language community: the link in a Spanish-language newsletter should be the `/es/` one, so readers don't land on the English interface first.

The prefix sets the language of the page contents around your events. Your events and your calendar's name and description appear in that language only where you've translated them, and in your primary language where you haven't.

### Sharing it

For print, write out the public URL in full. It's short because the handle is short, and a reader can type `arts.example/riverbend-folk` off a poster. Leave off the `https://`, which browsers fill in, and leave off any filters or language prefix unless the flyer is for that audience in particular.

::: tip <Lightbulb /> A note on where you put the link.
The places that keep working are the ones you set once and leave: your organization's website, your email signature, the description of your social accounts, the pinned post in your group chat. Each one quietly sends people to the calendar every time they look. Spend your effort there before announcing the link once in a busy chat thread, where it scrolls out of sight by the end of the week.
:::

## Your federation handle

Your handle has a second form that isn't a web address: `your-handle@your-instance.example`, as in `riverbend-folk@arts.example`. It's how calendars find each other across Pavillion instances. Another calendar owner types it into the **Follow a Calendar** box in their feed, and your events start arriving there for them to repost onto their own calendar. [Bring in events from other calendars](./follow-and-repost) covers what happens from there.

The handle is built from the same two parts as your public URL, in a different order. If your public URL is `https://arts.example/riverbend-folk`, your handle is `riverbend-folk@arts.example`. You saw it once already: the form you created the calendar in showed the domain after the name field, in exactly this shape.

Your handle shows up in two places without you doing anything:

- **Your instance's discovery page** at `your-instance.example/discover`, which lists the calendars on the instance with each one's handle under its name.
- **Other calendars' event pages.** When another calendar reposts one of your events, the event's page there carries a small label with your handle. It links back to your calendar, so a visitor who found the event somewhere else can find its source.

**The handle is for calendar owners, not visitors.** It looks like an email address but isn't one: mail sent to it goes nowhere, and pasting it into a browser's address bar doesn't open your calendar. Give it to people who run a calendar of their own and might want your events on it. Give everyone else the public URL.

## Things that trip people up

**A filtered link remembers its dates.** If you pick *This Week* or a custom range before copying the address, those exact dates are in the link. Someone who opens it a month later sees that old week, now empty. The week and month views do the same with the week or month on screen. For a link that stays current, use the list view and copy the address before touching the date control, or after clearing it. A category filter or search on its own doesn't have this problem.

**A link copied while signed in might be your editing address.** If you copied the URL from the browser while on the screen where you add events, your readers will hit a login page. Copy the public URL from the link under your calendar's name instead.

**A leading `@` breaks the handle.** Some social networks write handles as `@name@domain`. Pavillion's follow box expects `name@domain`, with no `@` in front. When you share your handle, write it without one.

## What's next

- Putting your calendar on your organization's own website — [Embed your calendar on your own website](./embed).
- Following other calendars and reposting their events — [Bring in events from other calendars](./follow-and-repost).
- What visitors see at the top of your public page — [Customize your calendar's identity](./identity).
