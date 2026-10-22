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
import { AVAILABLE_LANGUAGES, DEFAULT_LANGUAGE_CODE, isValidLanguageCode } from '@/common/i18n/languages';
import { changeLanguage } from '@/client/service/locale';

const authn = inject('authn') as AuthenticationService;
const { t, i18next } = useTranslation('profile');
const accountService = new AccountService();

/**
 * The language the UI is showing now, from the cookie, browser or instance
 * default when the account has no saved preference.
 */
function currentUiLanguage(): string {
  return isValidLanguageCode(i18next.language) ? i18next.language : DEFAULT_LANGUAGE_CODE;
}

const state = reactive({
  displayName: '',
  username: authn.userEmail()?.split('@')[0] || '',
  preferredLanguage: currentUiLanguage(),
  isLoading: true,
  isSaving: false,
});

// The save outcome is split across two live regions that stay rendered while
// empty: a status for success and an alert for errors. Screen readers can
// miss text inserted in the same render that creates or reveals a region.
const saveStatus = ref('');
const saveError = ref('');

/**
 * Load the profile into the form. The account's language is applied on login
 * and app load (see applySavedAccountLanguage), not here.
 *
 * The select shows the saved language, or the current UI language when none
 * is saved. It reads getPreferredLanguage rather than the profile's language,
 * which reports 'en' for an unset preference.
 */
async function loadProfile() {
  try {
    state.isLoading = true;
    const [profile, savedLanguage] = await Promise.all([
      accountService.getProfile(),
      accountService.getPreferredLanguage(),
    ]);
    state.displayName = profile.displayName || '';
    state.username = profile.username || profile.email.split('@')[0];
    state.preferredLanguage = savedLanguage ?? currentUiLanguage();
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
    saveStatus.value = '';
    saveError.value = '';

    const updatedProfile = await accountService.updateProfile(state.displayName);
    state.displayName = updatedProfile.displayName || '';

    saveStatus.value = t('display_name_saved', { defaultValue: 'Display name saved' });
    setTimeout(() => {
      saveStatus.value = '';
    }, 3000);
  }
  catch (error) {
    console.error('Error saving display name:', error);
    saveError.value = t('display_name_error', { defaultValue: 'Error saving display name' });
    setTimeout(() => {
      saveError.value = '';
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
            <div class="save-feedback">
              <span
                class="save-feedback__status"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >{{ saveStatus }}</span>
              <span
                class="save-feedback__error"
                role="alert"
                aria-atomic="true"
              >{{ saveError }}</span>
            </div>
          </div>

          <div class="profile-settings__field">
            <p id="username-label" class="profile-settings__label">
              {{ t("username_label", { defaultValue: "Username" }) }}
            </p>
            <div class="profile-settings__readonly" role="group" aria-labelledby="username-label">
              <span class="profile-settings__at" aria-hidden="true">@</span>
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

    /* Forced colours drop box-shadow, which is the only focus indicator
       here, so a system Highlight outline takes its place */
    @media (forced-colors: active) {
      outline: var(--pav-border-width-2) solid Highlight;
    }
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

    /* background-position has no logical keyword, so the chevron follows
       the padding to the inline end in right-to-left text */
    &:dir(rtl) {
      background-position: left 0.75rem center;
    }
  }
}

.save-feedback {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--pav-color-success);

  &__error {
    color: var(--pav-color-error);
  }
}

.profile-settings__readonly {
  display: flex;
  flex-wrap: wrap;
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
  min-inline-size: 0;
  color: var(--pav-text-secondary);
  overflow-wrap: anywhere;
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
