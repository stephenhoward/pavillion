import { useTranslation } from 'i18next-vue';

/**
 * Composable that resolves notification-row display strings stored as
 * i18n tokens into the recipient's locale at render time.
 *
 * ## Why a render-time resolver exists
 *
 * For `verb='Flag'` rows, `actor_display_name` is stored as a token
 * (`i18n:flag_actor_anonymous` or `i18n:flag_actor_remote{host:...}`)
 * rather than a literal string. The recipient's locale is not known at
 * insert time: a single Flag activity fans out to multiple recipients
 * (calendar owners, instance admins) who may each have a different
 * locale. Storing a literal would freeze one recipient's locale onto
 * the row.
 *
 * See the anonymization service for the token grammar:
 * `src/server/notifications/service/anonymize-flag-actor.ts`
 *
 * ## Token grammar handled here
 *
 *   - `i18n:flag_actor_anonymous`               → t('inbox:flag_actor_anonymous')
 *   - `i18n:flag_actor_remote{host:example.org}` → t('inbox:flag_actor_remote', { host: 'example.org' })
 *
 * Hostnames cannot contain `{`, `}`, `:`, or `,`, so the bare key:value
 * form parses unambiguously with a single regex.
 *
 * ## What it deliberately does NOT do
 *
 * - It does not call `t()` for arbitrary string inputs. Strings without
 *   the `i18n:` prefix pass through untouched — these are real actor
 *   display names (e.g., a follower's username) and translating them
 *   would be wrong.
 * - It does not throw on unknown token names or malformed parametric
 *   tokens. It returns the raw token string so a forward-incompatible
 *   row stays visible and traceable rather than rendering an empty or
 *   misleading translation.
 */

const I18N_TOKEN_PREFIX = 'i18n:';

/**
 * Allowlist of i18n token names this resolver understands. Adding a new
 * token (e.g., a future `flag_actor_system`) requires adding the name
 * here AND the matching translation key under the `inbox` namespace.
 *
 * Unknown token names fall through to "raw passthrough" so the row stays
 * visible in the inbox even when the client is older than the server.
 */
const KNOWN_TOKENS = new Set([
  'flag_actor_anonymous',
  'flag_actor_remote',
]);

/**
 * Names of tokens that require parameters to render meaningfully. A
 * token in this set with no `{...}` block falls back to raw passthrough
 * rather than rendering, e.g., "Reporter from " with an empty host.
 */
const PARAMETRIC_TOKENS = new Set(['flag_actor_remote']);

/**
 * Parses a token body like `flag_actor_remote{host:example.org}` into
 * its name and key:value params. Returns `null` if the body is not a
 * recognizable token form.
 */
function parseTokenBody(body: string): { name: string; params: Record<string, string> } | null {
  const paramsStart = body.indexOf('{');
  if (paramsStart === -1) {
    return { name: body, params: {} };
  }
  if (!body.endsWith('}')) {
    return null;
  }
  const name = body.slice(0, paramsStart);
  const paramsBody = body.slice(paramsStart + 1, -1);
  const params: Record<string, string> = {};
  if (paramsBody.length > 0) {
    for (const pair of paramsBody.split(',')) {
      const sep = pair.indexOf(':');
      if (sep === -1) {
        return null;
      }
      const key = pair.slice(0, sep);
      const value = pair.slice(sep + 1);
      if (key.length === 0) {
        return null;
      }
      params[key] = value;
    }
  }
  return { name, params };
}

export function useNotificationDisplay() {
  const { t } = useTranslation('inbox');

  /**
   * Resolves a `notification.actor.displayName` value for rendering.
   *
   * Plain strings (no `i18n:` prefix) are returned unchanged. Known
   * `i18n:` tokens are resolved via the `inbox` translation namespace
   * with any `{key:value}` params passed as interpolation values.
   *
   * @param displayName - The raw value from the API response.
   * @returns A user-facing string safe to render as plain text.
   */
  const resolveActorDisplayName = (displayName: string): string => {
    if (!displayName.startsWith(I18N_TOKEN_PREFIX)) {
      return displayName;
    }
    const body = displayName.slice(I18N_TOKEN_PREFIX.length);
    const parsed = parseTokenBody(body);
    if (parsed === null) {
      return displayName;
    }
    if (!KNOWN_TOKENS.has(parsed.name)) {
      return displayName;
    }
    if (PARAMETRIC_TOKENS.has(parsed.name) && Object.keys(parsed.params).length === 0) {
      return displayName;
    }
    return t(parsed.name, parsed.params);
  };

  return {
    resolveActorDisplayName,
  };
}
