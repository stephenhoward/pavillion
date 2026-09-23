---
description: Embed your Pavillion calendar on your own website — generate the snippet, configure allowed domains, and choose what the widget shows.
---

# Embed your calendar on your own website

> Status: partial. The allowed-domain section below is written; the rest of this guide will be written after launch.

If your community already has a website — an organization page, a venue site, a project landing page — you can put your Pavillion calendar directly on it instead of asking visitors to click through to a separate URL. You do that with the embed widget: a short piece of code, copied from your calendar's **Widget** tab, that shows your calendar inside a page on your site.

## Choose where your calendar can appear

Your widget appears on exactly one website: the one you name as the calendar's **Allowed Domain**. Until you name one, the embed code does nothing on other sites — paste it anywhere and visitors' browsers will refuse to show it. The preview on the **Widget** tab works either way, so you can set up how the widget looks before deciding where it goes.

This is a real restriction, not a label. When a page tries to show your widget, Pavillion tells the visitor's browser which sites are allowed to display it, using a standard web rule (a *Content-Security-Policy* header). Every current browser follows that rule. A site that isn't your allowed domain gets an empty box, or the browser's own "refused" message, where your calendar would have been.

### Why the restriction exists

Your events are public — anyone can read them on your calendar's page, link to them, or follow them from another calendar. The allowed domain doesn't change any of that. What it controls is where your calendar can be *displayed as part of someone else's page*.

That matters because a calendar sitting inside a website reads as belonging to that website. Without a restriction, any site — one you've never heard of, one you'd rather not be associated with — could frame your calendar and present your programming as its own. The allowed domain keeps that decision with you.

### What to enter

Enter the address visitors see in their browser's address bar, without `https://` and without anything after the first `/`.

- **`example.com` and `www.example.com` are the same site.** Enter either one; both will work.
- **Every other subdomain is a different site.** If your events page lives at `events.example.com`, enter `events.example.com` — `example.com` won't cover it, and neither will the reverse.
- **One domain per calendar.** There's no list to add a second site to. If a partner organization wants your events on their site too, the better route is usually for them to run their own calendar and [repost yours](follow-and-repost.md) — or to link to your [public calendar page](public-url.md).
- **Leave the port off** unless your site runs on an unusual one (you'd know — it appears after a colon in the address bar, like `example.org:8080`). If you enter a port, only that port works.
- **The site has to use `https://`.** A site served over plain `http://` can't show the widget.

Your domain is saved when you click <Btn>Update</Btn>. It can take up to a minute for the change to reach every page that embeds your calendar, so if the widget doesn't appear right away, wait a minute and reload before troubleshooting.

Changing the domain replaces the old one. The site you used to allow stops showing your calendar as soon as the change takes effect — worth remembering if you're moving your website to a new address and the old one is still live.

On instances that ask calendars to be [covered by a funding plan](funding.md) for embedding, the Allowed Domain section will ask for a plan before it saves a domain.

### Things that trip people up

- **Entering the hosting company instead of your address.** If your site is built on a hosted website builder but visitors reach it at `yourgroup.org`, enter `yourgroup.org` — whatever the address bar shows, not the builder's name.
- **Website builders that wrap custom code in a frame of their own.** Some builders don't put pasted HTML directly on your page; they load it inside a frame served from the builder's own domain. The browser checks every layer, so the widget is refused even though your domain is set correctly. If the widget shows up on a plain test page on your site but not inside a builder's "custom HTML" block, this is the likely cause — check whether your builder offers a way to add code directly to the page.
- **An empty box, or a browser message saying the content was refused.** That's the restriction working. Compare the address bar of the page with what you entered, character for character — a typo in the domain blocks the widget just as surely as a different site would.
- **Testing on a local copy of your site.** A copy running on your own computer (a `localhost` address) can always show the widget, so a developer can try it before the real domain is set. Don't take that as proof the live site will work; check it there too.

## Planned scope

- Generating the embed snippet
- What the widget shows vs. the full public site
- Basic styling and sizing guidance
