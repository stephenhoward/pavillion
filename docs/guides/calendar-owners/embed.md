---
description: Embed your Pavillion calendar on your own website — set the allowed domain, choose how the widget looks, and paste the embed code into your page.
---

# Embed your calendar on your own website

If your community already has a website — an organization page, a venue site, a project landing page — you can put your Pavillion calendar directly on it instead of asking visitors to click through to a separate URL. You do that with the embed widget: a short piece of code that shows your calendar inside a page on your site, with the same events, search and filters as your public calendar page.

Everything lives on one screen, **Settings → Calendar → Widget**, which works on whichever calendar is selected at the top of the settings screen. Owners and editors can both use it. The screen has three sections, and an embed needs all three:

1. **Allowed Domain** — the one website your calendar may appear on. Skip this and the widget won't show up anywhere but the preview.
2. **Widget Configuration** — which view visitors start on, the accent color, and light or dark mode.
3. **Embed Code** — the code you copy into your website.

This guide assumes your calendar is already set up and publishing events. If it isn't, start with the [quickstart](quickstart.md).

## Choose where your calendar can appear

Your widget appears on exactly one website: the one you name as the calendar's **Allowed Domain**. Until you name one, the embed code does nothing on other sites — paste it anywhere and visitors' browsers will refuse to show it. The preview on the Widget screen works either way, so you can set up how the widget looks before deciding where it goes.

### Why the restriction exists

Your events are public — anyone can read them on your calendar's page, link to them, or follow them from another calendar. The allowed domain doesn't change any of that. What it controls is where your calendar can be *displayed as part of someone else's page*.

That matters because a calendar sitting inside a website reads as belonging to that website. Without a restriction, any site — one you've never heard of, one you'd rather not be associated with — could frame your calendar and present your programming as its own. The allowed domain keeps that decision with you.

### What to enter

Enter the address visitors see in their browser's address bar, without `https://` and without anything after the first `/`.

- **`example.com` and `www.example.com` are the same site.** Enter either one; both will work.
- **Every other subdomain is a different site.** If your events page lives at `events.example.com`, enter `events.example.com` — `example.com` won't cover it, and neither will the reverse.
- **One domain per calendar.** There's no list to add a second site to. If a partner organization wants your events on their site too, the better route is for them to run their own calendar and [repost your events on it](follow-and-repost.md) — or to link to your [public calendar page](public-url.md).
- **Leave the port off** unless your site runs on an unusual one (you'd know — it appears after a colon in the address bar, like `example.org:8080`). If you enter a port, only that port works.
- **The site has to use `https://`.** A site served over plain `http://` can't show the widget.

Your domain is saved when you click <Btn>Update</Btn>. It can take up to a minute for the change to reach every page that embeds your calendar, so if the widget doesn't appear right away, wait a minute and reload before troubleshooting.

Once a domain is saved, the box shows it in grey until you type a new one. Changing the domain replaces the old one. The site you used to allow stops showing your calendar as soon as the change takes effect — worth remembering if you're moving your website to a new address and the old one is still live. There's no button to clear the domain altogether; to take your calendar off a site, remove the embed code from that site.

On instances that ask calendars to be [covered by a funding plan](funding.md) for embedding, the Allowed Domain section will ask for a funding plan before it saves a domain. Only the calendar's owner can start one; an editor sees a note saying the owner can enable embedding instead.

### Things that trip people up

- **Entering the hosting company instead of your address.** If your site is built on a hosted website builder but visitors reach it at `yourgroup.org`, enter `yourgroup.org` — whatever the address bar shows, not the builder's name.
- **Website builders that wrap custom code in a frame of their own.** Some builders don't put pasted HTML directly on your page; they load it inside a frame served from the builder's own domain. The browser checks every layer, so the widget is refused even though your domain is set correctly. If the widget shows up on a plain test page on your site but not inside a builder's "custom HTML" block, this is the likely cause — check whether your builder offers a way to add code directly to the page.
- **An empty box, or a browser message saying the content was refused.** That's the restriction working. Compare the address bar of the page with what you entered, character for character — a typo in the domain blocks the widget just as surely as a different site would.
- **Testing on a local copy of your site.** A copy running on your own computer (a `localhost` address) can always show the widget, so a developer can try it before the real domain is set. Don't take that as proof the live site will work; check it there too.

## Choose how the widget looks

The **Widget Configuration** section has three settings and a live preview beside them. The preview updates as you change things, but your embedded widget doesn't: nothing reaches your website until you click <Btn>Save Configuration</Btn>. After you save, the change can take up to a minute to show on your site.

You never need to copy the embed code again after changing these settings. The code only says *which* calendar to show; how it looks is read from Pavillion each time the widget loads.

### Choose the starting view

The view you pick on the Widget screen — list, week or month — is the one visitors see when the widget first loads. From there, they can switch views themselves as needed. Which views the widget offers depends on how much width it has on your page:

- **Small**, like a phone screen or a narrow sidebar: list only.
- **Medium**, like a small tablet or the main column of a typical web page: list and month.
- **Large**, like a full-width section on a desktop screen: list, week and month.

When your starting view isn't offered at the widget's width, it opens on the list instead. Most widgets sit in a page column, not across the full width of the screen, so a week starting view usually shows up as the list. If yours sits in a column like that, choose list or month as the starting view.

### Pick an accent color

The accent color is used for links, buttons and the other things visitors click inside the widget. It starts as Pavillion's orange. Set it to your website's main link or brand color, and the widget reads as part of your page rather than something dropped into it.

### Match light or dark mode to your site

**Color Mode** decides whether the widget has a light or dark background:

- **Light** or **Dark** always uses that one.
- **Auto**, the default, follows each *visitor's* device setting — not your website's.

Pick the one that matches your site. If your website is always light, choose Light: on Auto, a visitor whose phone is set to dark mode gets a dark calendar in the middle of your light page. Auto is the right choice only when your website itself switches between light and dark.

::: tip <Lightbulb /> A note on checking your accent color.
An accent color that looks fine on a light background can be hard to read on a dark one, and the reverse. If you choose Auto, flip Color Mode to Light and then Dark while watching the preview before you save, and make sure the accent reads clearly in both.
:::

## Put the code on your website

The **Embed Code** section has the code and a <Btn>Copy Code</Btn> button. Copy it rather than retyping it — it already contains your instance's address and your calendar's name, and a single wrong character stops it working.

Paste the whole thing, unchanged, at the spot on your page where the calendar should appear. On a page you edit as HTML, that's wherever you'd put any other block of content. On a website builder, use its block for custom HTML or embed code — and see the note above about builders that put that block inside a frame of their own. If your builder won't accept code containing `<script>` tags at all, the widget can't run there; link to your [public calendar page](public-url.md) instead.

### Sizing

You don't set a size in the code. The widget fills the full width of the space you put it in, and grows or shrinks in height to fit what it's showing — a long list makes it taller, a month grid shorter. So:

- **Control the width with your page layout.** A sidebar gives you a narrow list-only widget; a full-width section gives you all three views (see [the starting view](#choose-the-starting-view) above).
- **Don't put it in a box with a fixed height.** The widget can't grow past the box, and the bottom of the calendar gets cut off.

### Language

The widget's buttons and labels follow the language your web page declares (the `lang` setting on the page's `<html>` tag, which most website builders set from your site's language). If your page doesn't declare one, or declares one Pavillion doesn't support, the widget uses English. To choose the language yourself, add `data-lang` to the first line of the code — for Spanish, `<script async src="…/widget/pavillion-widget.js" data-lang="es"></script>`.

### One widget per page

The code is written to show one calendar on a page. Pasting it twice — the same calendar or two different ones — doesn't give you two working widgets. If you want two calendars side by side, put them on separate pages, or have one calendar [repost](follow-and-repost.md) the other's events so a single widget shows both.

## What the widget shows, and what it leaves out

The widget is your calendar, inside your page: the same events, the same search, category and date filters, and the same list, week and month views as your public calendar page. When a visitor opens an event, its details — date, time, place, description, *add to calendar* — open inside the widget, with a back link to the calendar.

Some things stay on your public calendar page only:

- **Your calendar's name and description.** The widget starts straight at the filters. Put your own heading above it.
- **The report link** on each event, for visitors who want to flag a problem.
- **A shareable link to each event.** Opening an event inside the widget doesn't change the address in the visitor's browser, so they can't copy a link to that event from your page. A visitor who wants to send an event to a friend needs your public calendar page, or the *add to calendar* option.

The quick test for whether to embed or link: is your website where your community already goes to find out what's on? If it is, embed — the calendar meets people where they are. If your site is mostly a front door that people pass through once, a prominent link to your [public calendar page](public-url.md) gives them the full version and a URL they can bookmark and share. Plenty of calendars do both: the widget on the website, and the public URL in newsletters and social posts.

## Things that trip people up

- **Changing a setting and not seeing it on your site.** The preview shows unsaved changes; your website doesn't. Click <Btn>Save Configuration</Btn>, wait a minute, and reload.
- **The bottom of the calendar is cut off.** The space you pasted the code into has a fixed height. Remove the height limit and let the widget size itself.
- **Week view never appears.** The widget is narrower than the large size, so week isn't offered. That's the space on your page, not a setting — see [the starting view](#choose-the-starting-view).
- **The widget shows in the wrong language.** Your page's `<html>` tag declares a different language from the one you expected. Fix it in your website's settings, or add `data-lang` to the code.

## What's next

- The page the widget's missing pieces live on — [Share your public calendar URL](public-url.md).
- What appears in the widget's lists — [Organize events with categories](categories.md), and the default event image and date range in [Customize your calendar's identity](identity.md).
- Getting your events onto a partner's site without a second embed — [Bring in events from other calendars](follow-and-repost.md).
