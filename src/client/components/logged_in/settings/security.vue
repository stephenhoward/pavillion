<script setup lang="ts">
/**
 * Account settings leaf: the email and password rows and the modals that
 * change them, and the help button for its guide. The settings layout
 * supplies the page heading and the column.
 */
import { reactive, inject, onMounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import type AuthenticationService from '@/client/service/authn';
import AccountService from '@/client/service/account';
import EmailModal from '@/client/components/logged_in/settings/email_modal.vue';
import PasswordModal from '@/client/components/logged_in/settings/password_modal.vue';
import HelpButton from '@/client/components/common/help-button.vue';

const authn = inject('authn') as AuthenticationService;
const { t } = useTranslation('profile');
const accountService = new AccountService();

const state = reactive({
  email: authn.userEmail(),
  changeEmail: false,
  changePassword: false,
});

/**
 * Refresh the shown address from the server; the session email stays on
 * screen if the load fails.
 */
async function loadEmail() {
  try {
    const profile = await accountService.getProfile();
    state.email = profile.email;
  }
  catch (error) {
    console.error('Error loading profile:', error);
  }
}

/**
 * Close the email modal, showing the new address when one was confirmed.
 */
function closeEmailModal(email?: string) {
  if (email) {
    state.email = email;
  }
  state.changeEmail = false;
}

onMounted(loadEmail);
</script>

<template>
  <div>
    <div class="security-settings__help">
      <HelpButton />
    </div>

    <div class="account-settings-card">
      <div class="account-settings-card__section security-settings">
        <div class="security-settings__row">
          <div class="security-settings__info">
            <p class="security-settings__label">{{ t("account_email_label", { defaultValue: "Email Address" }) }}</p>
            <p class="security-settings__value">{{ state.email }}</p>
          </div>
          <button
            type="button"
            class="btn-text"
            @click="state.changeEmail = true"
          >
            {{ t("change_email_button", { defaultValue: "Change Email" }) }}
          </button>
        </div>

        <div class="security-settings__row">
          <div class="security-settings__info">
            <p class="security-settings__label">{{ t("account_password_label", { defaultValue: "Password" }) }}</p>
            <p class="security-settings__value">{{ t("last_changed_unknown", { defaultValue: "Last changed: Unknown" }) }}</p>
          </div>
          <button
            type="button"
            class="btn-text"
            @click="state.changePassword = true"
          >
            {{ t("change_password_button", { defaultValue: "Change Password" }) }}
          </button>
        </div>
      </div>

      <EmailModal v-if="state.changeEmail" @close="closeEmailModal" />
      <PasswordModal v-if="state.changePassword" @close="state.changePassword = false" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.security-settings__help {
  display: flex;
  justify-content: flex-end;

  &:empty {
    display: none;
  }
}

.security-settings {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);
}

.security-settings__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--pav-space-2);

  & + & {
    padding-block-start: var(--pav-space-4);
    border-block-start: 1px solid var(--pav-border-subtle);
  }
}

.security-settings__info {
  flex: 1;
  min-width: 0;
}

.security-settings__label {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--pav-text-secondary);
}

.security-settings__value {
  margin: var(--pav-space-1) 0 0 0;
  font-size: 0.875rem;
  color: var(--pav-text-muted);
  overflow-wrap: anywhere;
}

.btn-text {
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--pav-color-interactive-active-text);
  background: transparent;
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: color 0.2s, background-color 0.2s;

  &:hover {
    color: var(--pav-color-interactive-active-text);
    background: var(--pav-color-interactive-active-bg);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-orange-600);
    outline-offset: 2px;
  }
}
</style>
