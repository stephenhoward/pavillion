# Session-Expiry Re-Login Modal

> Created: 2026-04-22
> Status: Approved — ready for implementation planning

## Context

When a user's JWT expires mid-session, XHR requests fail silently. The client has no global 401 interceptor (except one ad-hoc check in `src/client/composables/useEventEditor.ts:205-214`), no reactive auth store beyond `AuthenticationService`, and route guards only fire on initial navigation. The user's action appears to do nothing, their work vanishes on the next manual refresh, and there is no feedback.

This design preserves the user's in-place context by overlaying a re-login modal on top of the current view when session expiry is detected, then retrying the failed request(s) with a fresh token so the user's original action completes as if the session had never lapsed.

## Goals

- Detect mid-session JWT expiry globally and surface it once, not per-caller.
- Preserve the user's current view and form state while they re-authenticate.
- Transparently replay the XHR(s) that triggered detection so in-progress work completes.
- Fail gracefully to the existing `/auth/login` route if the user declines to re-authenticate.

## Non-Goals

- localStorage-backed draft persistence for forms.
- Changes to the 5-minute JWT expiry or 20-second auto-refresh window.
- A new Pinia auth store. `AuthenticationService` remains the single source of truth; reactive refs are added to it.
- Any server-side changes. The server already returns 401 on expired/invalid JWTs; that contract is untouched.

## Architecture

Three pieces, all additive:

1. **Global axios response interceptor** in `AuthenticationService`. Catches 401s on authenticated endpoints, queues the rejected request for retry, and flips a reactive `sessionExpired` flag.
2. **Reactive session state** on `AuthenticationService` (`sessionExpired: Ref<boolean>`). Exposed through the existing `app.provide('authn', ...)`; no new store.
3. **`<SessionExpiredModal>`** mounted once at the top-level client shell. Watches `sessionExpired`, renders `<Modal>` + `<LoginForm>`, drains the pending queue on success, or routes to `/auth/login` on dismissal.

Route guards, the existing `/auth/login` page, and the existing `_refresh_login` timer are all untouched. The modal is additive — on first nav you still land on the login route, on mid-session expiry you see the modal.

## Interceptor & Pending-Request Queue

Added to `AuthenticationService` constructor, alongside the existing request interceptor at `src/client/service/authn.ts:36-42`:

```ts
// Pseudocode
type PendingRequest = {
  config: AxiosRequestConfig;
  resolve: (value: AxiosResponse) => void;
  reject: (reason: unknown) => void;
};

private _pendingRequests: PendingRequest[] = [];
public sessionExpired = ref(false);

axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status;
    const url = error.config?.url ?? '';
    const isAuthEndpoint = url.includes('/api/auth/'); // login, refresh, forgot-password
    if (status !== 401 || isAuthEndpoint) {
      return Promise.reject(error);
    }
    return new Promise<AxiosResponse>((resolve, reject) => {
      this._pendingRequests.push({ config: error.config, resolve, reject });
      this.sessionExpired.value = true;
    });
  },
);
```

**Drain on success** (called by the modal after `login()` resolves truthy):

```ts
async drainPendingRequests() {
  const queue = this._pendingRequests.splice(0);
  for (const { config, resolve, reject } of queue) {
    try {
      // The request interceptor re-injects the fresh Bearer token.
      resolve(await axios.request(config));
    } catch (err) {
      reject(err);
    }
  }
  this.sessionExpired.value = false;
}
```

**Reject on dismissal** (called by the modal on close without success):

```ts
abortPendingRequests() {
  const queue = this._pendingRequests.splice(0);
  for (const { reject } of queue) reject(new SessionExpiredError());
  this.sessionExpired.value = false;
}
```

**Refresh-failure path.** The `catch` in `_refresh_login` (`authn.ts:472-498`) also sets `sessionExpired.value = true` so backgrounded tabs whose refresh cycle failed surface the modal on the user's next visible interaction, even before the next XHR 401s.

### Design rules

- **Only fire on authenticated endpoints.** The `isAuthEndpoint` guard prevents a 401 from the login endpoint itself (bad password) from recursively triggering the modal. Those are form-validation errors for the modal's own `<LoginForm>`.
- **Single-modal invariant.** Many parallel XHRs may 401 simultaneously. They all enqueue; `sessionExpired` flips to `true` at most once per cycle, keeping the modal single-instance.
- **Retry is idempotent by construction.** The server rejected the original request pre-execution (401 before handler runs), so replaying any method — including POST/PUT/PATCH/DELETE — is safe. A short comment near the interceptor documents this.

## Component Refactor

Split `src/client/components/logged_out/login.vue` into two components.

### New: `src/client/components/logged_out/LoginForm.vue`

Presentational, no routing.

- **Props:** `initialEmail?: string`
- **Emits:** `success` (fires when `authn.login()` resolves true)
- **Contains:** the `<form>` block, email/password inputs, `ErrorAlert`, submit button, and register / forgot-password `<router-link>`s
- **Does NOT** call `router.push('/calendar')`. Emits `success` and lets the parent decide.
- Register and forgot-password links remain `<router-link>`s. Clicking from inside the modal navigates away — acceptable since the session is already gone.

### Updated: `src/client/components/logged_out/login.vue`

Route view only.

- Keeps the welcome-card + info-aside layout and its existing `infoDescription` / `siteTitle` logic.
- Renders `<LoginForm :initial-email="route.query.email as string | undefined" @success="router.push('/calendar')" />`.

### New: `src/client/components/common/session-expired-modal.vue`

```vue
<script setup lang="ts">
import { inject } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import Modal from '@/client/components/common/modal.vue';
import LoginForm from '@/client/components/logged_out/LoginForm.vue';

const authn = inject('authn') as AuthenticationService;
const router = useRouter();
const { t } = useTranslation('authentication', { keyPrefix: 'session_expired' });

async function onSuccess() {
  await authn.drainPendingRequests(); // closes by flipping sessionExpired
}

function onClose() {
  authn.abortPendingRequests();
  router.push('/auth/login');
}
</script>

<template>
  <Modal :title="t('title')" size="md" @close="onClose">
    <p>{{ t('description') }}</p>
    <LoginForm :initial-email="authn.lastKnownEmail" @success="onSuccess" />
  </Modal>
</template>
```

`authn.lastKnownEmail` is populated by `authn.login()` on its last successful call so the modal pre-fills the email field.

### Mount point

`src/client/components/app.vue` (top-level client shell, already the mount point for `<ToastContainer>`):

```vue
<template>
  <RouterView />
  <ToastContainer />
  <SessionExpiredModal v-if="authn.sessionExpired.value" />
</template>
```

The modal at the true root is correct even for logged-out views: the flag only flips on authenticated 401s, so the modal never opens on pre-login pages.

## Edge Cases

| Case | Behavior |
|------|----------|
| 403 Forbidden | Pass through — not a session issue. |
| 401 from `/api/auth/login` | Guarded by `isAuthEndpoint`. Inline form error in the modal. |
| Refresh endpoint fails | `_refresh_login` catch sets `sessionExpired = true`. |
| Parallel 401s | All enqueue; single modal opens. |
| User dismisses modal | Queue rejected with `SessionExpiredError`, route to `/auth/login`. |
| Mutating retry | Safe: server rejected pre-handler, so replay is idempotent. |

## Cleanup

- Delete the ad-hoc 401 check in `src/client/composables/useEventEditor.ts:205-214`. The global interceptor subsumes it.

## Testing

- **Unit — `LoginForm.vue`** (moves most assertions from the existing `test/login.vue.test.ts`): email/password validation, error rendering, `success` emission on valid login, `initialEmail` prop preseeds the email field.
- **Unit — `login.vue`** (reduced): renders welcome-card, forwards `?email=` to `LoginForm`, navigates to `/calendar` on `@success`.
- **Unit — `session-expired-modal.vue`**: renders `<Modal>` and `<LoginForm>`, calls `drainPendingRequests` on `@success`, calls `abortPendingRequests` + router push on `@close`.
- **Unit — `AuthenticationService`**:
  - 401 on authenticated endpoint → queued + flag set
  - 401 on `/api/auth/*` → passes through, flag untouched
  - 403 → passes through
  - `drainPendingRequests` replays with fresh Bearer and resolves originals
  - `abortPendingRequests` rejects with `SessionExpiredError`
  - `_refresh_login` failure flips the flag
  - Parallel 401s produce one flag flip, many queued entries
- **Integration (Vitest)**: mocked axios adapter — flow a 401 through, flip flag, simulate login success, assert original request is retried and resolves.
- **E2E (Playwright, optional — defer unless trivial)**: invalidate stored JWT mid-session, trigger an XHR, assert the modal appears, submit valid creds, assert the pending action completes and the view is unchanged.

## Files Touched

- `src/client/service/authn.ts` — add response interceptor, `sessionExpired` ref, `_pendingRequests` queue, `drainPendingRequests`, `abortPendingRequests`, `lastKnownEmail`, refresh-failure hook
- `src/client/components/logged_out/LoginForm.vue` — new, extracted form
- `src/client/components/logged_out/login.vue` — thinned to route-view wrapper
- `src/client/components/common/session-expired-modal.vue` — new
- `src/client/components/app.vue` — mount the modal
- `src/client/composables/useEventEditor.ts` — remove the ad-hoc 401 block
- `src/client/locales/*/authentication.json` — add `session_expired.title` and `session_expired.description` keys
- `src/common/exceptions/authentication.ts` (or nearest equivalent) — `SessionExpiredError`
- `src/client/test/login.vue.test.ts` — split / retarget to `LoginForm.vue`
- New test files for `session-expired-modal.vue` and the interceptor behavior

## Verification

1. `npm run lint`
2. `npm run test:unit` — new and modified tests pass
3. `npm run test:integration` — existing suite still passes
4. Manual via `npm run dev`:
   a. Log in at `http://localhost:3000/auth/login` (`admin@pavillion.dev` / `admin`)
   b. Open devtools → Application → localStorage → overwrite `jwt` with an expired / garbage value
   c. Trigger any authenticated action (e.g. open a calendar, save an event)
   d. Assert: session-expired modal opens over the current view; the underlying view is not reloaded
   e. Enter valid credentials, submit
   f. Assert: modal closes, the original action completes (e.g. event saved), the user's view is unchanged
   g. Repeat (a-c), then press Escape / click backdrop
   h. Assert: user is routed to `/auth/login`, pending request resolves as rejected
5. Optional Playwright MCP walkthrough of the above for a recorded smoke test.

## Out of Scope (restated)

- Form draft persistence / localStorage-backed restoration
- Changes to JWT expiry or auto-refresh timing
- New Pinia auth store
- Server-side changes
