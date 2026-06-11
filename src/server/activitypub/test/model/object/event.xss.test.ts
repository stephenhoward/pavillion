import { describe, it, expect } from 'vitest';

import { EventObject } from '@/server/activitypub/model/object/event';

/**
 * XSS regression suite for the FEDERATED-CONTENT strip path (pv-dzy3).
 *
 * Config under test: the module-private `stripHtmlTags` in
 * `src/server/activitypub/model/object/event.ts` —
 *   `striptags(he.decode(html)).trim()`
 * This is the ONLY sanitizer on inbound federated text fields. It is NOT
 * DOMPurify: there is no allowlist and no DOM parse. striptags is a
 * state-machine stripper that removes everything between `<` and `>`; he.decode
 * runs first so HTML entity references re-materialize into live tag tokens that
 * striptags then removes.
 *
 * Audit notes anchored here (full audit on the bead):
 *   - he.decode runs ONLY on text fields routed through stripHtmlTags. URL
 *     fields (attachment href, pavillion id) bypass decode entirely and go raw
 *     to sanitizeExternalUrlHref / _validatePavillionId — out of scope here.
 *   - Double-encoded entities are EXPECTED to survive as inert entity text
 *     (one he.decode pass un-nests one level), never as live markup. See the
 *     double-encode block below for the asserted direction.
 *
 * stripHtmlTags is module-private by design (event.test.ts drives it through
 * public entry points rather than exporting it); these tests follow the same
 * convention via `EventObject.fromActivityPubObject`. The assertions confirm
 * every text-field ingestion branch yields plain text: no `<tag` token, no
 * `on*=` handler, no `javascript:`/`data:` attribute scheme.
 *
 * SECURITY BOUNDARY these "inert" assertions rely on:
 *   Federated event text fields are stored as PLAIN TEXT and are NEVER bound
 *   via `v-html`. The only `v-html` sink in the app is admin-authored policy
 *   markdown in instance-policy.vue (guarded by the DOMPurify pipeline tested
 *   in render-markdown.test.ts). Because federated text reaches the DOM only
 *   through text interpolation, token-absence (no `<tag`, no `on*=`, no live
 *   scheme) is a sufficient inertness check here.
 *   IF a future feature ever binds a federated event field to `v-html`, this
 *   boundary collapses: these token-absence assertions would NO LONGER be
 *   sufficient, and that field would need a DOMPurify-grade allowlist sanitizer
 *   instead of the striptags strip path.
 */

/** A parsed field is inert when it carries no tag token, handler, or live scheme. */
function expectInert(value: unknown): void {
  expect(typeof value).toBe('string');
  const s = value as string;
  // No opening tag token survives (striptags removes < … >).
  expect(s).not.toMatch(/<[a-z!/]/i);
  // No inline event-handler attribute survives.
  expect(s).not.toMatch(/\son\w+\s*=/i);
  // No dangerous URI scheme wired into an attribute survives.
  expect(s).not.toMatch(/=\s*["']?\s*(?:javascript|data|vbscript):/i);
}

describe('EventObject.fromActivityPubObject — federated XSS strip path', () => {

  // ---------------------------------------------------------------------------
  // Positive controls: one per ingestion branch. Benign HTML must strip to the
  // expected NON-EMPTY plain text. These run first so the negative assertions
  // below are trustworthy — they prove the harness actually reaches each branch
  // and that stripping happens (rather than the field being dropped/empty).
  // ---------------------------------------------------------------------------
  describe('positive controls (harness wiring per ingestion branch)', () => {
    it('bare name/summary strips benign HTML to plain text', () => {
      const r = EventObject.fromActivityPubObject({
        name: '<p>Hello <strong>world</strong></p>',
        summary: '<em>Friendly</em> description',
      });
      expect(r.content.en.name).toBe('Hello world');
      expect(r.content.en.description).toBe('Friendly description');
    });

    it('bare content string fallback strips benign HTML to plain text', () => {
      const r = EventObject.fromActivityPubObject({
        name: 'Title',
        content: '<p>Body <b>text</b></p>',
      });
      expect(r.content.en.description).toBe('Body text');
    });

    it('nameMap/summaryMap strip benign HTML per language', () => {
      const r = EventObject.fromActivityPubObject({
        nameMap: { en: '<b>Bold</b> Title', es: '<i>Evento</i>' },
        summaryMap: { en: '<u>Desc</u>', es: 'Normal' },
      });
      expect(r.content.en.name).toBe('Bold Title');
      expect(r.content.es.name).toBe('Evento');
      expect(r.content.en.description).toBe('Desc');
    });

    it('contentMap fallback (no summaryMap) strips benign HTML to plain text', () => {
      const r = EventObject.fromActivityPubObject({
        nameMap: { en: 'Title' },
        contentMap: { en: '<p>Html <strong>Body</strong></p>' },
      });
      expect(r.content.en.description).toBe('Html Body');
    });

    it('pavillion:content strips benign HTML in name, description, accessibilityInfo', () => {
      const r = EventObject.fromActivityPubObject({
        'pavillion:content': {
          en: {
            name: '<b>Festival</b>',
            description: '<p>A <em>fun</em> time</p>',
            accessibilityInfo: '<i>Ramp access</i>',
          },
        },
      });
      expect(r.content.en.name).toBe('Festival');
      expect(r.content.en.description).toBe('A fun time');
      expect(r.content.en.accessibilityInfo).toBe('Ramp access');
    });

    it('pavillion:place strips benign HTML in name, address, accessibilityInfo', () => {
      const r = EventObject.fromActivityPubObject({
        'pavillion:place': {
          id: 'https://peer.example/p/1',
          address: '<b>123</b> Main St',
          content: { en: { name: '<i>City Park</i>', accessibilityInfo: '<u>Step-free</u>' } },
        },
      });
      expect(r.location.name).toBe('City Park');
      expect(r.location.address).toBe('123 Main St');
      expect(r.location.content.en.accessibilityInfo).toBe('Step-free');
    });

    it('pavillion:space (parent-path matched) strips benign HTML in content', () => {
      const r = EventObject.fromActivityPubObject({
        'pavillion:place': {
          id: 'https://peer.example/p/1',
          content: { en: { name: 'Parent Place' } },
        },
        'pavillion:space': {
          id: 'https://peer.example/p/1/spaces/9',
          content: { en: { name: '<b>Main Hall</b>', accessibilityInfo: '<i>Wide doors</i>' } },
        },
      });
      expect(r.space.content.en.name).toBe('Main Hall');
      expect(r.space.content.en.accessibilityInfo).toBe('Wide doors');
    });

    it('flat as:location string strips benign HTML to plain text', () => {
      const r = EventObject.fromActivityPubObject({ location: '<b>Downtown</b> Plaza' });
      expect(r.location.name).toBe('Downtown Plaza');
    });

    it('flat as:Place object strips benign HTML in name and address fields', () => {
      const r = EventObject.fromActivityPubObject({
        location: {
          type: 'Place',
          name: '<b>Hall</b>',
          address: {
            type: 'PostalAddress',
            streetAddress: '<i>5</i> Ave',
            addressLocality: '<em>Springfield</em>',
          },
        },
      });
      expect(r.location.name).toBe('Hall');
      expect(r.location.address).toBe('5 Ave');
      expect(r.location.city).toBe('Springfield');
    });
  });

  // ---------------------------------------------------------------------------
  // Raw-markup vectors: literal tags reaching the strip path. striptags removes
  // the tag tokens; only inert text content may remain.
  // ---------------------------------------------------------------------------
  describe('raw-markup vectors strip to inert text', () => {
    const rawVectors: Array<{ name: string; input: string }> = [
      { name: 'raw <script>', input: '<script>alert(1)</script>Title' },
      { name: '<img> onerror handler', input: '<img src=x onerror=alert(1)>Title' },
      { name: '<svg><script>', input: '<svg><script>alert(1)</script></svg>Title' },
      { name: '<a> javascript: href', input: '<a href="javascript:alert(1)">Title</a>' },
      { name: '<iframe> srcdoc', input: '<iframe srcdoc="<script>alert(1)</script>">Title</iframe>' },
    ];
    for (const { name, input } of rawVectors) {
      it(`bare name: ${name}`, () => {
        const r = EventObject.fromActivityPubObject({ name: input });
        expectInert(r.content.en.name);
        expect(r.content.en.name).not.toContain('script>');
      });
    }

    it('pavillion:content name + description strip raw markup inertly', () => {
      const r = EventObject.fromActivityPubObject({
        'pavillion:content': {
          en: {
            name: '<script>alert("xss")</script>Event',
            description: '<img src=x onerror=alert(1)>Desc',
          },
        },
      });
      expectInert(r.content.en.name);
      expectInert(r.content.en.description);
    });

    it('flat as:Place name strips raw markup inertly', () => {
      const r = EventObject.fromActivityPubObject({
        location: { type: 'Place', name: '<script>alert(1)</script>Park' },
      });
      expectInert(r.location.name);
    });
  });

  // ---------------------------------------------------------------------------
  // Single-encoded entities: the REAL decode-then-strip probe. he.decode turns
  // &lt;script&gt; back into a live <script> token BEFORE striptags runs, so a
  // sanitizer that stripped first and decoded second would leak markup. This
  // confirms ordering: decode → strip → inert.
  // ---------------------------------------------------------------------------
  describe('single-encoded entity vectors (decode-then-strip)', () => {
    const encVectors: Array<{ name: string; input: string }> = [
      { name: '&lt;script&gt; entity', input: '&lt;script&gt;alert(1)&lt;/script&gt;Title' },
      { name: '&lt;img onerror&gt; entity', input: '&lt;img src=x onerror=alert(1)&gt;Title' },
    ];
    for (const { name, input } of encVectors) {
      it(`bare name: ${name}`, () => {
        const r = EventObject.fromActivityPubObject({ name: input });
        expectInert(r.content.en.name);
      });
    }

    it('summary field decodes-then-strips single-encoded markup', () => {
      const r = EventObject.fromActivityPubObject({
        summary: '&lt;script&gt;steal(cookies)&lt;/script&gt;Safe description',
      });
      expectInert(r.content.en.description);
    });

    it('nameMap value decodes-then-strips single-encoded markup', () => {
      const r = EventObject.fromActivityPubObject({
        nameMap: { en: '&lt;img src=x onerror=alert(1)&gt;Evento' },
        summaryMap: { en: 'Desc' },
      });
      expectInert(r.content.en.name);
    });
  });

  // ---------------------------------------------------------------------------
  // Double-encoded entities: CONTRACT test. he.decode runs exactly once, so
  // `&amp;lt;script&amp;gt;` un-nests one level to the inert TEXT `<script>`
  // (entity-decoded but NOT re-parsed as markup). The assertion direction:
  // the result is plain text containing the literal characters `<script>`, and
  // it is inert — there is no live tag token because striptags sees a `<`
  // followed by text, not a parser-recognized element with attributes, and the
  // value is never re-decoded. This documents that a single decode pass cannot
  // be chained by an attacker into live markup.
  // ---------------------------------------------------------------------------
  describe('double-encoded entity vectors (contract: inert text, not markup)', () => {
    it('double-encoded script un-nests one level to inert entity text', () => {
      const r = EventObject.fromActivityPubObject({ name: '&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;' });
      // One he.decode pass: &amp; -> & leaves the literal text "<script>…".
      // striptags then removes the angle-bracketed run, leaving inert text.
      // The field is plain text with no live handler/scheme and is never
      // decoded a second time, so no execution context exists.
      expectInert(r.content.en.name);
      // Positive direction: the (now inert) decoded content is present as text,
      // confirming we tested the real un-nest behavior rather than a drop.
      expect(r.content.en.name).toContain('alert(1)');
    });
  });

  // ---------------------------------------------------------------------------
  // striptags parser-edge cases: striptags is a state machine, not a DOM
  // parser. These probe its tokenizer boundaries — no-whitespace attribute
  // separators, null bytes in tag position, and unterminated/broken close
  // sequences. Each must still yield inert output.
  // ---------------------------------------------------------------------------
  describe('striptags parser-edge vectors', () => {
    it('no-whitespace attribute separator (<img/onerror=...>)', () => {
      const r = EventObject.fromActivityPubObject({ name: '<img/onerror=alert(1)>Title' });
      expectInert(r.content.en.name);
    });

    it('null byte inside a tag-name run', () => {
      // A NUL embedded in the opening tag-name. striptags treats `<`…`>` as a
      // tag regardless of interior bytes, so the whole run is removed.
      const input = 'pre <scr' + String.fromCharCode(0) + 'ipt>alert(1)</script> post';
      const r = EventObject.fromActivityPubObject({ name: input });
      expectInert(r.content.en.name);
      expect(r.content.en.name).not.toContain('script');
    });

    it('unterminated/broken close-tag sequence', () => {
      const r = EventObject.fromActivityPubObject({ name: '<img src=x onerror=alert(1)//Trailing' });
      expectInert(r.content.en.name);
    });

    it('mixed live + entity-encoded markup in one field', () => {
      const r = EventObject.fromActivityPubObject({ name: 'Hi <b>there</b> &lt;script&gt;x&lt;/script&gt;' });
      expectInert(r.content.en.name);
    });
  });
});
