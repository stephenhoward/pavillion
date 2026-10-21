<script setup lang="ts">
/**
 * Account settings leaf: display name, read-only username and preferred
 * language. The settings layout supplies the page heading and the column, so
 * this leaf renders only its card.
 */
import { reactive, inject, onMounted, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import type AuthenticationService from '@/client/service/authn';
import AccountService from '@/client/service/account';
import { AVAILABLE_LANGUAGES } from '@/common/i18n/languages';
import { changeLanguage, applyAccountLanguage } from '@/client/service/locale';
import HelpButton from '@/client/components/common/help-button.vue';

const authn = inject('authn') as AuthenticationService;
const { t } = useTranslation('profile');
const accountService = new AccountService();

const state = reactive({
  displayName: '',
  username: authn.userEmail()?.split('@')[0] || '',
  preferredLanguage: 'en',
  isLoading: true,
  isSaving: false,
});

const saveMessage = ref<string | null>(null);
const saveIsError = ref(false);

/**
 * Load the profile and apply the account's language to the UI.
 */
async function loadProfile() {
  try {
    state.isLoading = true;
    const profile = await accountService.getProfile();
    state.displayName = profile.displayName || '';
    state.username = profile.username || profile.email.split('@')[0];
    state.preferredLanguage = profile.language || 'en';

    await applyAccountLanguage(profile.language);
  }
  catch (error) {
    console.error('Error loading profile:', error);
  }
  finally {
    state.isLoading = false;
  }
}

/**
 * Switch the UI language and persist it to the account.
 * Reads the selected language directly from the change event target.
 */
async function handleLanguageChange(event: Event) {
  const language = (event.target as HTMLSelectElement).value;
  state.preferredLanguage = language;

  await changeLanguage(language, async (lang) => {
    await accountService.updateLanguage(lang);
  });
}

/**
 * Save the display name on blur and announce the outcome in the live region.
 */
async function handleDisplayNameChange() {
  // Don't save if still loading initial data
  if (state.isLoading) {
    return;
  }

  try {
    state.isSaving = true;
    saveMessage.value = null;
    saveIsError.value = false;

    const updatedProfile = await accountService.updateProfile(state.displayName);
    state.displayName = updatedProfile.displayName || '';

    saveMessage.value = t('display_name_saved', { defaultValue: 'Display name saved' });
    setTimeout(() => {
      saveMessage.value = null;
    }, 3000);
  }
  catch (error) {
    console.error('Error saving display name:', error);
    saveMessage.value = t('display_name_error', { defaultValue: 'Error saving display name' });
    saveIsError.value = true;
    setTimeout(() => {
      saveMessage.value = null;
    }, 5000);
  }
  finally {
    state.isSaving = false;
  }
}

onMounted(loadProfile);
</script>

<template>
  <div class="profile-settings">
    <div class="profile-settings__help">
      <HelpButton />
    </div>

    <div class="account-settings-card">
      <section class="account-settings-card__section">
        <div class="profile-settings__fields">
          <div class="profile-settings__field">
            <label for="display-name" class="profile-settings__label">
              {{ t("display_name_label", { defaultValue: "Display Name" }) }}
            </label>
            <input
              id="display-name"
              type="text"
              v-model="state.displayName"
              :placeholder="t('display_name_placeholder', { defaultValue: 'Your display name' })"
              :disabled="state.isLoading || state.isSaving"
              class="profile-settings__input"
              @blur="handleDisplayNameChange"
            />
            <span
              class="save-feedback"
              :class="{ 'is-error': saveMessage && saveIsError, 'is-visible': saveMessage }"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >{{ saveMessage ?? '' }}</span>
          </div>

          <div class="profile-settings__field">
            <p id="username-label" class="profile-settings__label">
              {{ t("username_label", { defaultValue: "Username" }) }}
            </p>
            <div class="profile-settings__readonly" role="group" aria-labelledby="username-label">
              <span class="profile-settings__at">@</span>
              <span class="profile-settings__username">{{ state.username }}</span>
              <span class="profile-settings__badge">{{ t("readonly_badge", { defaultValue: "Read-only" }) }}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="account-settings-card__section">
        <h2 class="profile-settings__section-title">{{ t("preferences_section", { defaultValue: "PREFERENCES" }) }}</h2>

        <div class="profile-settings__field">
          <label for="language" class="profile-settings__label">
            {{ t("language_preference_label", { defaultValue: "Preferred Language" }) }}
          </label>
          <select
            id="language"
            :value="state.preferredLanguage"
            class="profile-settings__input profile-settings__input--select"
            :disabled="state.isLoading || undefined"
            @change="handleLanguageChange"
          >
            <option
              v-for="lang in AVAILABLE_LANGUAGES"
              :key="lang.code"
              :value="lang.code"
            >
              {{ lang.nativeName }}
            </option>
          </select>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
.profile-settings__help {
  display: flex;
  justify-content: flex-end;

  &:empty {
    display: none;
  }
}

.profile-settings__section-title {
  margin: 0 0 var(--pav-space-4) 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--pav-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.profile-settings__fields {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);
}

.profile-settings__field {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-2);
}

.profile-settings__label {
  display: block;
  margin: 0;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--pav-text-secondary);
}

.profile-settings__input {
  width: 100%;
  padding: 0.625rem 1rem;
  background: var(--pav-surface-secondary);
  border: 1px solid var(--pav-border-subtle);
  border-radius: 0.75rem;
  color: var(--pav-text-primary);
  font-size: 1rem;
  transition: box-shadow 0.2s, border-color 0.2s;

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px var(--pav-color-orange-500);
    border-color: transparent;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &--select {
    padding-inline-end: 2.5rem;
    background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
    background-position: right 0.75rem center;
    background-repeat: no-repeat;
    background-size: 1.5em 1.5em;
    cursor: pointer;
    appearance: none;
  }
}

.save-feedback {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--pav-color-success);

  &:not(.is-visible) {
    visibility: hidden;
  }

  &.is-error {
    color: var(--pav-color-error);
  }
}

.profile-settings__readonly {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  background: var(--pav-surface-tertiary);
  border: 1px solid var(--pav-border-subtle);
  border-radius: 0.75rem;
}

.profile-settings__at {
  color: var(--pav-text-muted);
}

.profile-settings__username {
  color: var(--pav-text-secondary);
}

.profile-settings__badge {
  margin-inline-start: auto;
  padding: 0.125rem 0.5rem;
  font-size: 0.75rem;
  color: var(--pav-text-secondary);
  background: var(--pav-interactive-disabled);
  border-radius: 9999px;
}
</style>
