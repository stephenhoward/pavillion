import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { anonymizeFlagActor } from '@/server/notifications/service/anonymize-flag-actor';

describe('anonymizeFlagActor', () => {
  // ---------------------------------------------------------------------------
  // Invariants common to every input
  // ---------------------------------------------------------------------------

  describe('invariants', () => {
    it('always returns actor_kind = "anonymous" regardless of input', () => {
      const local = anonymizeFlagActor({ kind: 'account', accountId: uuidv4() });
      const remote = anonymizeFlagActor({ kind: 'remote_actor', uri: 'https://example.org/users/alice' });
      const web = anonymizeFlagActor({ kind: 'anonymous_web' });

      expect(local.actor_kind).toBe('anonymous');
      expect(remote.actor_kind).toBe('anonymous');
      expect(web.actor_kind).toBe('anonymous');
    });

    it('never populates actor_account_id', () => {
      const local = anonymizeFlagActor({ kind: 'account', accountId: uuidv4() });
      const remote = anonymizeFlagActor({ kind: 'remote_actor', uri: 'https://example.org/users/alice' });
      const web = anonymizeFlagActor({ kind: 'anonymous_web' });

      expect(local.actor_account_id).toBeNull();
      expect(remote.actor_account_id).toBeNull();
      expect(web.actor_account_id).toBeNull();
    });

    it('never populates actor_uri', () => {
      const local = anonymizeFlagActor({ kind: 'account', accountId: uuidv4() });
      const remote = anonymizeFlagActor({ kind: 'remote_actor', uri: 'https://example.org/users/alice' });
      const web = anonymizeFlagActor({ kind: 'anonymous_web' });

      expect(local.actor_uri).toBeNull();
      expect(remote.actor_uri).toBeNull();
      expect(web.actor_uri).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Local account reporter
  // ---------------------------------------------------------------------------

  describe('local account reporter', () => {
    it('returns the anonymous i18n token and null URL', () => {
      const result = anonymizeFlagActor({ kind: 'account', accountId: uuidv4() });
      expect(result.actor_display_name).toBe('i18n:flag_actor_anonymous');
      expect(result.actor_display_url).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Anonymous web-form reporter
  // ---------------------------------------------------------------------------

  describe('anonymous web-form reporter', () => {
    it('returns the anonymous i18n token and null URL', () => {
      const result = anonymizeFlagActor({ kind: 'anonymous_web' });
      expect(result.actor_display_name).toBe('i18n:flag_actor_anonymous');
      expect(result.actor_display_url).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Remote AP actor reporter
  // ---------------------------------------------------------------------------

  describe('remote AP actor reporter', () => {
    it('returns the per-host i18n token and instance-root URL for a valid actor URI', () => {
      const result = anonymizeFlagActor({
        kind: 'remote_actor',
        uri: 'https://example.org/users/alice',
      });
      expect(result.actor_display_name).toBe('i18n:flag_actor_remote{host:example.org}');
      expect(result.actor_display_url).toBe('https://example.org');
    });

    it('lowercases the hostname in both token and URL', () => {
      const result = anonymizeFlagActor({
        kind: 'remote_actor',
        uri: 'https://EXAMPLE.ORG/users/alice',
      });
      expect(result.actor_display_name).toBe('i18n:flag_actor_remote{host:example.org}');
      expect(result.actor_display_url).toBe('https://example.org');
    });

    it('NFKC-normalizes fullwidth hostnames to defeat homograph variants', () => {
      // Fullwidth "example" → "example"
      const result = anonymizeFlagActor({
        kind: 'remote_actor',
        uri: 'https://ｅｘａｍｐｌｅ.com/users/alice',
      });
      expect(result.actor_display_name).toBe('i18n:flag_actor_remote{host:example.com}');
      expect(result.actor_display_url).toBe('https://example.com');
    });

    it('drops port, path, and query — keeps only scheme + host', () => {
      const result = anonymizeFlagActor({
        kind: 'remote_actor',
        uri: 'https://example.org:8443/users/alice?foo=bar#frag',
      });
      expect(result.actor_display_url).toBe('https://example.org');
    });

    it('falls back to fully-anonymous when URI is malformed', () => {
      const result = anonymizeFlagActor({
        kind: 'remote_actor',
        uri: 'not a url',
      });
      expect(result.actor_display_name).toBe('i18n:flag_actor_anonymous');
      expect(result.actor_display_url).toBeNull();
    });

    it('falls back to fully-anonymous when URI scheme is http', () => {
      const result = anonymizeFlagActor({
        kind: 'remote_actor',
        uri: 'http://example.org/users/alice',
      });
      expect(result.actor_display_name).toBe('i18n:flag_actor_anonymous');
      expect(result.actor_display_url).toBeNull();
    });

    it('falls back to fully-anonymous when URI contains userinfo', () => {
      const result = anonymizeFlagActor({
        kind: 'remote_actor',
        uri: 'https://user:pass@example.org/users/alice',
      });
      expect(result.actor_display_name).toBe('i18n:flag_actor_anonymous');
      expect(result.actor_display_url).toBeNull();
    });

    it('falls back to fully-anonymous when hostname is an IPv4 literal', () => {
      const result = anonymizeFlagActor({
        kind: 'remote_actor',
        uri: 'https://192.168.1.1/users/alice',
      });
      expect(result.actor_display_name).toBe('i18n:flag_actor_anonymous');
      expect(result.actor_display_url).toBeNull();
    });

    it('falls back to fully-anonymous when hostname is an IPv6 literal', () => {
      const result = anonymizeFlagActor({
        kind: 'remote_actor',
        uri: 'https://[2001:db8::1]/users/alice',
      });
      expect(result.actor_display_name).toBe('i18n:flag_actor_anonymous');
      expect(result.actor_display_url).toBeNull();
    });
  });
});
