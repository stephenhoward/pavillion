import { describe, it, expect, beforeEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';

import { useNotificationDisplay } from '@/client/composables/useNotificationDisplay';

/**
 * Calls `useNotificationDisplay().resolveActorDisplayName(input)` inside
 * a real Vue setup context so the i18next-vue inject is satisfied.
 * Returns the rendered text of a host component whose template is the
 * resolver's return value, which is exactly what the inbox renders.
 */
function resolve(input: string): string {
  const Host = defineComponent({
    setup() {
      const { resolveActorDisplayName } = useNotificationDisplay();
      return () => h('span', resolveActorDisplayName(input));
    },
  });

  const wrapper = mount(Host, {
    global: {
      plugins: [[I18NextVue, { i18next }]],
    },
  });
  return wrapper.text();
}

describe('useNotificationDisplay', () => {
  beforeEach(async () => {
    await i18next.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: {
          inbox: {
            flag_actor_anonymous: 'Anonymous reporter',
            flag_actor_remote: 'Reporter from {{host}}',
          },
        },
      },
    });
  });

  describe('resolveActorDisplayName', () => {
    it('passes plain strings through unchanged', () => {
      expect(resolve('Alice')).toBe('Alice');
    });

    it('passes through strings without the i18n: prefix even when they look token-like', () => {
      // No `i18n:` prefix — treat as a literal display name.
      expect(resolve('flag_actor_anonymous')).toBe('flag_actor_anonymous');
    });

    it('resolves the parameterless anonymous Flag token', () => {
      expect(resolve('i18n:flag_actor_anonymous')).toBe('Anonymous reporter');
    });

    it('resolves the remote Flag token and substitutes the host param', () => {
      expect(resolve('i18n:flag_actor_remote{host:example.org}')).toBe('Reporter from example.org');
    });

    it('preserves non-ASCII host params through substitution', () => {
      // NFKC-normalized output of the server may include punycode or
      // unicode hosts. The resolver must not mangle them.
      expect(resolve('i18n:flag_actor_remote{host:xn--mnchen-3ya.de}')).toBe(
        'Reporter from xn--mnchen-3ya.de',
      );
    });

    it('falls back to the raw token string for unknown token names', () => {
      // An unknown token key means a forward-incompatible row. We do not
      // want to throw, but we also do not want to silently render a
      // misleading translation. Return the raw token so the bug is
      // visible and traceable.
      const unknown = 'i18n:flag_actor_unknown_future_token';
      expect(resolve(unknown)).toBe(unknown);
    });

    it('falls back to the raw token when the parametric token has no params', () => {
      // `flag_actor_remote` requires a `host` param. A token without
      // params cannot render a sensible string; preserve the raw token
      // so the malformation surfaces rather than rendering "Reporter from ".
      const malformed = 'i18n:flag_actor_remote';
      expect(resolve(malformed)).toBe(malformed);
    });

    it('returns empty string for an empty input', () => {
      expect(resolve('')).toBe('');
    });
  });
});
