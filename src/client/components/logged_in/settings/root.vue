<script setup>
import { reactive, inject, onMounted, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import EmailModal from '@/client/components/logged_in/settings/email_modal.vue';
import PasswordModal from '@/client/components/logged_in/settings/password_modal.vue';
import PolicyLink from '@/client/components/common/PolicyLink.vue';
import FundingService from '@/client/service/funding';
import AccountService from '@/client/service/account';
import { AVAILABLE_LANGUAGES } from '@/common/i18n/languages';
import { changeLanguage, applyAccountLanguage } from '@/client/service/locale';
import HelpButton from '@/client/components/common/help-button.vue';

const router = useRouter();
const authn = inject('authn');

const state = reactive({
  userInfo: {
    isAdmin: authn.isAdmin(),
    email: authn.userEmail(),
    displayName: '',
    username: authn.userEmail()?.split('@')[0] || '',
    preferredLanguage: 'en',
  },
  changeEmail: false,
  changePassword: false,
  isLoading: true,
  isSaving: false,
});

const saveMessage = ref(null);

const { t } = useTranslation('profile');

const fundingEnabled = ref(false);
const fundingPlanStatus = ref(null);
const fundingService = new FundingService();
const accountService = new AccountService();

/**
 * Computed status summary for the funding card.
 * Shows formatted amount with billing cycle when active, or a fallback message.
 */
const fundingStatusSummary = computed(() => {
  const status = fundingPlanStatus.value;

  if (status && status.status === 'active') {
    const formattedAmount = FundingService.formatCurrency(status.amount, status.currency);
    const cycle = status.billing_cycle === 'yearly'
      ? t('funding_card_cycle_year', { defaultValue: '/yr' })
      : t('funding_card_cycle_month', { defaultValue: '/mo' });
    return `${t('funding_card_status_active', { defaultValue: 'Active' })} - ${formattedAmount}${cycle}`;
  }

  return t('funding_card_status_none', { defaultValue: 'No active plan' });
});

/**
 * Load user profile data from server
 */
async function loadProfile() {
  try {
    state.isLoading = true;
    const profile = await accountService.getProfile();
    state.userInfo.displayName = profile.displayName || '';
    state.userInfo.email = profile.email;
    state.userInfo.username = profile.username || profile.email.split('@')[0];
    state.userInfo.preferredLanguage = profile.language || 'en';

    // Apply account language to the UI after loading profile
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
 * Check if subscriptions are enabled on this instance
 */
async function checkFundingEnabled() {
  try {
    const options = await fundingService.getOptions();
    fundingEnabled.value = options.enabled;
  }
  catch (error) {
    // Silently fail - funding is not enabled if we can't fetch options
    fundingEnabled.value = false;
  }
}

/**
 * Load the current user's funding plan status
 */
async function loadFundingStatus() {
  try {
    fundingPlanStatus.value = await fundingService.getStatus();
  }
  catch (error) {
    // Silently fail - no status means no active plan
    fundingPlanStatus.value = null;
  }
}

/**
 * Handle language change -- updates i18next, writes cookie, and persists to API.
 * Reads the selected language directly from the change event target.
 */
async function handleLanguageChange(event) {
  const language = event.target.value;
  state.userInfo.preferredLanguage = language;

  await changeLanguage(language, async (lang) => {
    await accountService.updateLanguage(lang);
  });
}

/**
 * Handle display name change
 */
async function handleDisplayNameChange() {
  // Don't save if still loading initial data
  if (state.isLoading) {
    return;
  }

  try {
    state.isSaving = true;
    saveMessage.value = null;

    const updatedProfile = await accountService.updateProfile(state.userInfo.displayName);
    state.userInfo.displayName = updatedProfile.displayName || '';

    // Show success message briefly
    saveMessage.value = t('display_name_saved', { defaultValue: 'Display name saved' });
    setTimeout(() => {
      saveMessage.value = null;
    }, 3000);
  }
  catch (error) {
    console.error('Error saving display name:', error);
    saveMessage.value = t('display_name_error', { defaultValue: 'Error saving display name' });
    setTimeout(() => {
      saveMessage.value = null;
    }, 5000);
  }
  finally {
    state.isSaving = false;
  }
}

/**
 * Handle logout
 */
function handleLogout() {
  // Use router to navigate to logout
  router.push({ name: 'logout' });
}

onMounted(async () => {
  await Promise.all([
    loadProfile(),
    checkFundingEnabled(),
    loadFundingStatus(),
  ]);
});
</script>

<template>
  <div class="settings-page">
    <div class="settings-container">
      <!-- Page Header -->
      <div class="page-header">
        <div class="page-header__title-row">
          <h1>{{ t("title") }}</h1>
          <HelpButton />
        </div>
        <p class="subtitle">{{ t("subtitle", { defaultValue: "Manage your account preferences" }) }}</p>
      </div>

      <!-- Settings Card -->
      <div class="settings-card">
        <!-- Profile Section -->
        <section class="settings-section">
          <h2 class="section-title">{{ t("profile_section", { defaultValue: "PROFILE" }) }}</h2>

          <div class="settings-fields">
            <!-- Display Name -->
            <div class="form-field">
              <label for="display-name" class="field-label">
                {{ t("display_name_label", { defaultValue: "Display Name" }) }}
              </label>
              <div class="input-with-feedback">
                <input
                  id="display-name"
                  type="text"
                  v-model="state.userInfo.displayName"
                  :placeholder="t('display_name_placeholder', { defaultValue: 'Your display name' })"
                  :disabled="state.isLoading || state.isSaving"
                  class="text-input"
                  @blur="handleDisplayNameChange"
                />
                <span
                  class="save-feedback"
                  :class="{ 'is-error': saveMessage && (saveMessage.includes('Error') || saveMessage.includes('error')), 'is-visible': saveMessage }"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >{{ saveMessage ?? '' }}</span>
              </div>
            </div>

            <!-- Username (read-only) -->
            <div class="form-field">
              <p id="username-label" class="field-label">
                {{ t("username_label", { defaultValue: "Username" }) }}
              </p>
              <div class="readonly-field" role="group" aria-labelledby="username-label">
                <span class="at-symbol">@</span>
                <span class="username-text">{{ state.userInfo.username }}</span>
                <span class="readonly-badge">{{ t("readonly_badge", { defaultValue: "Read-only" }) }}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- Preferences Section -->
        <section class="settings-section">
          <h2 class="section-title">{{ t("preferences_section", { defaultValue: "PREFERENCES" }) }}</h2>

          <div class="settings-fields">
            <!-- Language -->
            <div class="form-field">
              <label for="language" class="field-label">
                {{ t("language_preference_label", { defaultValue: "Preferred Language" }) }}
              </label>
              <select
                id="language"
                :value="state.userInfo.preferredLanguage"
                class="select-input"
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
          </div>
        </section>

        <!-- Security Section -->
        <section class="settings-section">
          <h2 class="section-title">{{ t("security_section", { defaultValue: "SECURITY" }) }}</h2>

          <div class="settings-fields security-fields">
            <!-- Email -->
            <div class="security-row">
              <div class="security-info">
                <p class="security-label">{{ t("account_email_label", { defaultValue: "Email Address" }) }}</p>
                <p class="security-value">{{ state.userInfo.email }}</p>
              </div>
              <button
                type="button"
                class="btn-text"
                @click="state.changeEmail = true"
              >
                {{ t("change_email_button", { defaultValue: "Change Email" }) }}
              </button>
            </div>

            <!-- Password -->
            <div class="security-row">
              <div class="security-info">
                <p class="security-label">{{ t("account_password_label", { defaultValue: "Password" }) }}</p>
                <p class="security-value">{{ t("last_changed_unknown", { defaultValue: "Last changed: Unknown" }) }}</p>
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
        </section>

        <!-- Logout Section -->
        <section class="logout-section">
          <PolicyLink source="settings" />
          <button
            type="button"
            class="logout-button"
            @click="handleLogout"
          >
            <div class="logout-icon">
              <svg class="icon"
                   aria-hidden="true"
                   fill="none"
                   viewBox="0 0 24 24"
                   stroke="currentColor">
                <path stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </div>
            <div class="logout-text">
              <p class="logout-title">{{ t("logout", { defaultValue: "Log Out" }) }}</p>
              <p class="logout-subtitle">{{ t("logout_description", { defaultValue: "Sign out of your account" }) }}</p>
            </div>
          </button>
        </section>
      </div>

      <!-- Instance Administration Card (Admin Only) -->
      <div v-if="state.userInfo.isAdmin" class="admin-card">
        <div class="admin-header">
          <h2>{{ t("admin_section", { defaultValue: "Instance Administration" }) }}</h2>
        </div>
        <div class="admin-body">
          <p class="admin-description">
            {{ t("admin_description", { defaultValue: "Manage server settings, user accounts, federation policies, and funding configuration for this Pavillion instance." }) }}
          </p>
          <router-link to="/admin/settings" class="btn-admin">
            {{ t("admin_link", { defaultValue: "Open Admin Settings" }) }}
            <svg class="icon-arrow"
                 aria-hidden="true"
                 fill="none"
                 viewBox="0 0 24 24"
                 stroke="currentColor">
              <path stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9 5l7 7-7 7" />
            </svg>
          </router-link>
        </div>
      </div>

      <!-- Funding Plan Card (if enabled) -->
      <div v-if="fundingEnabled" class="funding-card">
        <div class="funding-card-header">
          <div class="funding-card-icon">
            <svg class="icon"
                 aria-hidden="true"
                 fill="none"
                 viewBox="0 0 24 24"
                 stroke="currentColor">
              <path stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div class="funding-card-title-group">
            <h2>{{ t("funding_card_title", { defaultValue: "Funding Plan" }) }}</h2>
            <p class="funding-card-status">{{ fundingStatusSummary }}</p>
          </div>
        </div>
        <div class="funding-card-body">
          <router-link to="/funding" class="btn-funding">
            {{ t("funding_card_action", { defaultValue: "Manage Funding Plan" }) }}
            <svg class="icon-arrow"
                 aria-hidden="true"
                 fill="none"
                 viewBox="0 0 24 24"
                 stroke="currentColor">
              <path stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9 5l7 7-7 7" />
            </svg>
          </router-link>
        </div>
      </div>
    </div>

    <!-- Modals -->
    <EmailModal v-if="state.changeEmail" @close="(email) => { if(email) state.userInfo.email = email; state.changeEmail = false; }" />
    <PasswordModal v-if="state.changePassword" @close="state.changePassword = false" />
  </div>
</template>

<style scoped lang="scss">
.settings-page {
  min-height: 100vh;
  background: var(--pav-surface-secondary);
}

.settings-container {
  max-width: 42rem; // 672px (max-w-2xl)
  margin: 0 auto;
  padding: var(--pav-space-4);

  @media (min-width: 640px) {
    padding: var(--pav-space-6) var(--pav-space-6);
  }

  @media (min-width: 1024px) {
    padding: var(--pav-space-8) var(--pav-space-8);
  }
}

.page-header {
  margin-bottom: var(--pav-space-8);

  &__title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h1 {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--pav-text-primary);
    margin: 0;
  }

  .subtitle {
    margin-top: var(--pav-space-1);
    font-size: 0.875rem;
    color: var(--pav-text-muted);
  }
}

.settings-card {
  background: var(--pav-surface-primary);
  border-radius: 1rem;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  border: 1px solid var(--pav-border-secondary);
  overflow: hidden;
}

.settings-section {
  padding: var(--pav-space-6);
  border-bottom: 1px solid var(--pav-border-subtle);

  &:last-child {
    border-bottom: none;
  }
}

.section-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--pav-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 var(--pav-space-4) 0;
}

.settings-fields {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-2);
}

.field-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--pav-text-secondary);
}

.input-with-feedback {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-2);
}

.text-input {
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
}

.save-feedback {
  font-size: 0.875rem;
  color: var(--pav-color-success);
  font-weight: 500;

  &:not(.is-visible) {
    visibility: hidden;
  }

  &.is-error {
    color: var(--pav-color-error);
  }
}

.readonly-field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  background: var(--pav-surface-tertiary);
  border: 1px solid var(--pav-border-subtle);
  border-radius: 0.75rem;

  .at-symbol {
    color: var(--pav-text-muted);
  }

  .username-text {
    color: var(--pav-text-secondary);
  }

  .readonly-badge {
    margin-left: auto;
    font-size: 0.75rem;
    color: var(--pav-text-muted);
    background: var(--pav-interactive-disabled);
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
  }
}

.select-input {
  width: 100%;
  padding: 0.625rem 2.5rem 0.625rem 1rem;
  background-color: var(--pav-surface-secondary);
  background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
  background-position: right 0.75rem center;
  background-repeat: no-repeat;
  background-size: 1.5em 1.5em;
  border: 1px solid var(--pav-border-subtle);
  border-radius: 0.75rem;
  color: var(--pav-text-primary);
  font-size: 1rem;
  cursor: pointer;
  appearance: none;
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
}

.security-fields {
  gap: var(--pav-space-4);
}

.security-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: var(--pav-space-2);

  &:not(:first-child) {
    border-top: 1px solid var(--pav-border-subtle);
    padding-top: var(--pav-space-4);
  }
}

.security-info {
  flex: 1;

  .security-label {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--pav-text-secondary);
  }

  .security-value {
    margin: var(--pav-space-1) 0 0 0;
    font-size: 0.875rem;
    color: var(--pav-text-muted);
  }
}

.btn-text {
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--pav-color-interactive-active);
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

.logout-section {
  padding: var(--pav-space-6);
}

.logout-button {
  display: flex;
  align-items: center;
  gap: var(--pav-space-3);
  width: 100%;
  padding: var(--pav-space-3);
  margin: calc(var(--pav-space-3) * -1);
  background: transparent;
  border: none;
  border-radius: 0.75rem;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.2s;

  &:hover {
    background: rgba(239, 68, 68, 0.1);
  }

  .logout-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem;
    background: rgba(239, 68, 68, 0.1);
    border-radius: 0.5rem;

    .icon {
      width: 1.25rem;
      height: 1.25rem;
      color: var(--pav-color-red-600);
    }
  }

  .logout-text {
    flex: 1;

    .logout-title {
      margin: 0;
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--pav-color-red-600);
    }

    .logout-subtitle {
      margin: var(--pav-space-1) 0 0 0;
      font-size: 0.75rem;
      color: var(--pav-text-muted);
    }
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-red-600);
    outline-offset: 2px;
  }
}

.admin-card {
  margin-top: var(--pav-space-8);
  background: var(--pav-surface-primary);
  border-radius: 0.75rem;
  border: 1px solid var(--pav-border-secondary);
  overflow: hidden;

  .admin-header {
    padding: var(--pav-space-6) var(--pav-space-6) var(--pav-space-4);
    border-bottom: 1px solid var(--pav-border-secondary);

    h2 {
      margin: 0;
      font-size: 1.125rem;
      font-weight: 500;
      color: var(--pav-text-primary);
    }
  }

  .admin-body {
    padding: var(--pav-space-6);

    .admin-description {
      margin: 0 0 var(--pav-space-4) 0;
      font-size: 0.875rem;
      color: var(--pav-text-muted);
    }
  }
}

.btn-admin {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1.25rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: white;
  background: var(--pav-color-orange-500);
  border: none;
  border-radius: 9999px;
  cursor: pointer;
  text-decoration: none;
  transition: background-color 0.2s, box-shadow 0.2s;

  &:hover {
    background: var(--pav-color-orange-600);
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px var(--pav-color-orange-500), 0 0 0 4px rgba(249, 115, 22, 0.2);
  }

  .icon-arrow {
    width: 1rem;
    height: 1rem;
  }
}

.funding-card {
  margin-top: var(--pav-space-8);
  background: var(--pav-surface-primary);
  border-radius: 0.75rem;
  border: 1px solid var(--pav-border-secondary);
  overflow: hidden;

  .funding-card-header {
    display: flex;
    align-items: center;
    gap: var(--pav-space-3);
    padding: var(--pav-space-6) var(--pav-space-6) var(--pav-space-4);
    border-bottom: 1px solid var(--pav-border-secondary);
  }

  .funding-card-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem;
    background: var(--pav-color-interactive-active-bg);
    border-radius: 0.5rem;

    .icon {
      width: 1.25rem;
      height: 1.25rem;
      color: var(--pav-color-interactive-active);
    }
  }

  .funding-card-title-group {
    flex: 1;

    h2 {
      margin: 0;
      font-size: 1.125rem;
      font-weight: 500;
      color: var(--pav-text-primary);
    }

    .funding-card-status {
      margin: var(--pav-space-1) 0 0 0;
      font-size: 0.875rem;
      color: var(--pav-text-muted);
    }
  }

  .funding-card-body {
    padding: var(--pav-space-6);
  }
}

.btn-funding {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1.25rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: white;
  background: var(--pav-color-orange-500);
  border: none;
  border-radius: 9999px;
  cursor: pointer;
  text-decoration: none;
  transition: background-color 0.2s, box-shadow 0.2s;

  &:hover {
    background: var(--pav-color-orange-600);
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px var(--pav-color-orange-500), 0 0 0 4px rgba(249, 115, 22, 0.2);
  }

  .icon-arrow {
    width: 1rem;
    height: 1rem;
  }
}
</style>
