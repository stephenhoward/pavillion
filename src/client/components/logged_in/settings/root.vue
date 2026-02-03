<script setup>
import { reactive, inject, onMounted, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import EmailModal from '@/client/components/logged_in/settings/email_modal.vue';
import PasswordModal from '@/client/components/logged_in/settings/password_modal.vue';
import SubscriptionService from '@/client/service/subscription';
import AccountService from '@/client/service/account';

const authn = inject('authn');

const state = reactive({
  userInfo: {
    isAdmin: authn.isAdmin(),
    email: authn.userEmail(),
    displayName: '',
    username: authn.userEmail()?.split('@')[0] || '',
    preferredLanguage: 'en', // TODO: Get from user profile
  },
  changeEmail: false,
  changePassword: false,
  isLoading: true,
  isSaving: false,
});

const saveMessage = ref(null);

const { t } = useTranslation('profile');

const subscriptionsEnabled = ref(false);
const subscriptionService = new SubscriptionService();
const accountService = new AccountService();

// Available languages
const languages = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'pt', name: 'Português' },
  { code: 'it', name: 'Italiano' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pl', name: 'Polski' },
  { code: 'ar', name: 'العربية' },
  { code: 'he', name: 'עברית' },
];

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
async function checkSubscriptionsEnabled() {
  try {
    const options = await subscriptionService.getOptions();
    subscriptionsEnabled.value = options.enabled;
  }
  catch (error) {
    // Silently fail - subscriptions are not enabled if we can't fetch options
    subscriptionsEnabled.value = false;
  }
}

/**
 * Handle language change
 */
function handleLanguageChange() {
  // TODO: Implement language preference saving
  console.log('Language changed to:', state.userInfo.preferredLanguage);
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
  window.location.href = '/logout';
}

onMounted(async () => {
  await Promise.all([
    loadProfile(),
    checkSubscriptionsEnabled(),
  ]);
});
</script>

<template>
  <div class="settings-page">
    <div class="settings-container">
      <!-- Page Header -->
      <div class="page-header">
        <h1>{{ t("title") }}</h1>
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
                <transition name="fade">
                  <span v-if="saveMessage" class="save-feedback" :class="{ 'is-error': saveMessage.includes('Error') || saveMessage.includes('error') }">
                    {{ saveMessage }}
                  </span>
                </transition>
              </div>
            </div>

            <!-- Username (read-only) -->
            <div class="form-field">
              <label class="field-label">
                {{ t("username_label", { defaultValue: "Username" }) }}
              </label>
              <div class="readonly-field">
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
                v-model="state.userInfo.preferredLanguage"
                class="select-input"
                @change="handleLanguageChange"
              >
                <option v-for="lang in languages" :key="lang.code" :value="lang.code">
                  {{ lang.name }}
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
          <button
            type="button"
            class="logout-button"
            @click="handleLogout"
          >
            <div class="logout-icon">
              <svg class="icon"
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

      <!-- Subscription Link (if enabled) -->
      <div v-if="subscriptionsEnabled" class="subscription-link-wrapper">
        <router-link class="subscription-link" to="/subscription">
          {{ t("subscription_link") }}
        </router-link>
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
  background: var(--pav-color-stone-50);

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-950);
  }
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

  h1 {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--pav-color-stone-900);
    margin: 0;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
    }
  }

  .subtitle {
    margin-top: var(--pav-space-1);
    font-size: 0.875rem;
    color: var(--pav-color-stone-500);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }
}

.settings-card {
  background: white;
  border-radius: 1rem;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  border: 1px solid var(--pav-color-stone-200);
  overflow: hidden;

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-900);
    border-color: var(--pav-color-stone-800);
  }
}

.settings-section {
  padding: var(--pav-space-6);
  border-bottom: 1px solid var(--pav-color-stone-100);

  &:last-child {
    border-bottom: none;
  }

  @media (prefers-color-scheme: dark) {
    border-bottom-color: var(--pav-color-stone-800);
  }
}

.section-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--pav-color-stone-400);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 var(--pav-space-4) 0;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-500);
  }
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
  color: var(--pav-color-stone-700);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-300);
  }
}

.input-with-feedback {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-2);
}

.text-input {
  width: 100%;
  padding: 0.625rem 1rem;
  background: var(--pav-color-stone-50);
  border: 1px solid var(--pav-color-stone-200);
  border-radius: 0.75rem;
  color: var(--pav-color-stone-900);
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

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-800);
    border-color: var(--pav-color-stone-700);
    color: var(--pav-color-stone-100);
  }
}

.save-feedback {
  font-size: 0.875rem;
  color: var(--pav-color-green-600);
  font-weight: 500;

  &.is-error {
    color: var(--pav-color-red-600);
  }

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-green-400);

    &.is-error {
      color: var(--pav-color-red-400);
    }
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.readonly-field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  background: var(--pav-color-stone-100);
  border: 1px solid var(--pav-color-stone-200);
  border-radius: 0.75rem;

  @media (prefers-color-scheme: dark) {
    background: rgba(41, 37, 36, 0.5);
    border-color: var(--pav-color-stone-700);
  }

  .at-symbol {
    color: var(--pav-color-stone-400);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-500);
    }
  }

  .username-text {
    color: var(--pav-color-stone-600);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }

  .readonly-badge {
    margin-left: auto;
    font-size: 0.75rem;
    color: var(--pav-color-stone-400);
    background: var(--pav-color-stone-200);
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-500);
      background: var(--pav-color-stone-700);
    }
  }
}

.select-input {
  width: 100%;
  padding: 0.625rem 2.5rem 0.625rem 1rem;
  background-color: var(--pav-color-stone-50);
  background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
  background-position: right 0.75rem center;
  background-repeat: no-repeat;
  background-size: 1.5em 1.5em;
  border: 1px solid var(--pav-color-stone-200);
  border-radius: 0.75rem;
  color: var(--pav-color-stone-900);
  font-size: 1rem;
  cursor: pointer;
  appearance: none;
  transition: box-shadow 0.2s, border-color 0.2s;

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px var(--pav-color-orange-500);
    border-color: transparent;
  }

  @media (prefers-color-scheme: dark) {
    background-color: var(--pav-color-stone-800);
    border-color: var(--pav-color-stone-700);
    color: var(--pav-color-stone-100);
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
    border-top: 1px solid var(--pav-color-stone-100);
    padding-top: var(--pav-space-4);

    @media (prefers-color-scheme: dark) {
      border-top-color: var(--pav-color-stone-800);
    }
  }
}

.security-info {
  flex: 1;

  .security-label {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--pav-color-stone-700);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-300);
    }
  }

  .security-value {
    margin: var(--pav-space-1) 0 0 0;
    font-size: 0.875rem;
    color: var(--pav-color-stone-500);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }
}

.btn-text {
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--pav-color-orange-600);
  background: transparent;
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: color 0.2s, background-color 0.2s;

  &:hover {
    color: var(--pav-color-orange-700);
    background: rgba(249, 115, 22, 0.1);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-orange-300);
      background: rgba(249, 115, 22, 0.1);
    }
  }

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-orange-400);
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

    @media (prefers-color-scheme: dark) {
      background: rgba(127, 29, 29, 0.3);
    }
  }

  .logout-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem;
    background: rgba(239, 68, 68, 0.1);
    border-radius: 0.5rem;

    @media (prefers-color-scheme: dark) {
      background: rgba(127, 29, 29, 0.5);
    }

    .icon {
      width: 1.25rem;
      height: 1.25rem;
      color: var(--pav-color-red-600);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-red-400);
      }
    }
  }

  .logout-text {
    flex: 1;

    .logout-title {
      margin: 0;
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--pav-color-red-600);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-red-400);
      }
    }

    .logout-subtitle {
      margin: var(--pav-space-1) 0 0 0;
      font-size: 0.75rem;
      color: var(--pav-color-stone-500);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-stone-400);
      }
    }
  }
}

.admin-card {
  margin-top: var(--pav-space-8);
  background: white;
  border-radius: 0.75rem;
  border: 1px solid var(--pav-color-stone-200);
  overflow: hidden;

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-900);
    border-color: var(--pav-color-stone-800);
  }

  .admin-header {
    padding: var(--pav-space-6) var(--pav-space-6) var(--pav-space-4);
    border-bottom: 1px solid var(--pav-color-stone-200);

    @media (prefers-color-scheme: dark) {
      border-bottom-color: var(--pav-color-stone-800);
    }

    h2 {
      margin: 0;
      font-size: 1.125rem;
      font-weight: 500;
      color: var(--pav-color-stone-900);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-stone-100);
      }
    }
  }

  .admin-body {
    padding: var(--pav-space-6);

    .admin-description {
      margin: 0 0 var(--pav-space-4) 0;
      font-size: 0.875rem;
      color: var(--pav-color-stone-500);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-stone-400);
      }
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

.subscription-link-wrapper {
  margin-top: var(--pav-space-4);
  text-align: center;
}

.subscription-link {
  color: var(--pav-color-orange-600);
  text-decoration: underline;
  font-size: 0.875rem;

  &:hover {
    color: var(--pav-color-orange-700);
  }

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-orange-400);

    &:hover {
      color: var(--pav-color-orange-300);
    }
  }
}
</style>
