<script setup lang="ts">
import { inject } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';

import Modal from '@/client/components/common/modal.vue';
import LoginForm from '@/client/components/logged_out/LoginForm.vue';
import { currentAccountId } from '@/client/service/authn';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { resetUserStores } from '@/client/stores/reset-user-stores';

const authn = inject('authn') as any;
const router = useRouter();
const calendarStore = useCalendarStore();

const { t } = useTranslation('authentication', {
  keyPrefix: 'session_expired',
});

// Captured at setup: by the time `success` fires, login() has already
// overwritten the stored token.
const previousAccountId: string | null = authn.lastKnownAccountId();

/**
 * After re-authentication, carry on where the account left off, unless a
 * different or unknown account signed in. The "before" identity comes from
 * authn (the expired token can no longer answer via `currentAccountId()`) and
 * from the calendar store; every known id must match the new account, so a
 * store loaded for another account vetoes a replay.
 *
 * When neither source knows the previous account, or the ids differ, the
 * previous account's state is cleared and its queued requests are aborted,
 * never replayed: replaying them under the new token would attribute the
 * previous account's mutations to the new one.
 */
async function handleSuccess() {
  const current = currentAccountId();
  const known = [previousAccountId, calendarStore.accountId].filter((id) => id != null);
  if (current !== null && known.length > 0 && known.every((id) => id === current)) {
    await authn.drainPendingRequests();
    return;
  }
  resetUserStores();
  authn.abortPendingRequests();
  router.replace('/');
}

function handleClose() {
  authn.abortPendingRequests();
  router.push('/auth/login');
}
</script>

<template>
  <Modal
    :title="t('title')"
    size="md"
    @close="handleClose"
  >
    <p class="session-expired-description">{{ t('description') }}</p>
    <LoginForm
      :initial-email="authn.lastKnownEmail ?? ''"
      @success="handleSuccess"
    />
  </Modal>
</template>

<style scoped lang="scss">
.session-expired-description {
  margin: 0 0 var(--pav-space-lg) 0;
  color: var(--pav-text-secondary);
  font-size: 0.9375rem;
  line-height: 1.5;
}
</style>
