<template>
  <Modal :title="t('grants.form.section_title')" modal-class="grant-form-modal" @close="$emit('close')">
    <form class="grant-form" @submit.prevent="submitCreateGrant" novalidate>
      <!-- Account Selector -->
      <div class="form-group">
        <label class="form-label" for="grant-account">
          {{ t("grants.form.account_label") }}
          <span class="form-required" aria-hidden="true">*</span>
        </label>
        <div class="account-search-wrapper">
          <input
            id="grant-account"
            type="text"
            v-model="state.accountSearchQuery"
            :placeholder="t('grants.form.account_placeholder')"
            class="form-input"
            :class="{ 'form-input--error': state.errors.account }"
            autocomplete="off"
            role="combobox"
            aria-autocomplete="list"
            :aria-expanded="state.showAccountDropdown ? 'true' : 'false'"
            aria-controls="account-search-dropdown"
            :aria-activedescendant="activeDescendantId"
            :aria-invalid="state.errors.account ? 'true' : 'false'"
            :aria-describedby="state.errors.account ? 'grant-account-error' : undefined"
            @input="onAccountInputChange"
            @keydown="handleAccountSearchKeydown"
            @blur="handleAccountBlur"
            @focus="() => { if (state.accountSearchResults.length > 0) state.showAccountDropdown = true }"
          />
          <ul
            v-if="state.showAccountDropdown"
            id="account-search-dropdown"
            class="account-dropdown"
            role="listbox"
            :aria-label="t('grants.form.account_label')"
          >
            <li
              v-if="state.accountSearchLoading"
              class="account-dropdown-item account-dropdown-item--loading"
              role="option"
              aria-selected="false"
            >
              {{ t("grants.form.searching") }}
            </li>
            <li
              v-else-if="state.accountSearchResults.length === 0"
              class="account-dropdown-item account-dropdown-item--empty"
              role="option"
              aria-selected="false"
            >
              {{ t("grants.form.no_results") }}
            </li>
            <li
              v-for="(account, index) in state.accountSearchResults"
              :key="account.id"
              :id="`account-option-${index}`"
              class="account-dropdown-item"
              :class="{ 'account-dropdown-item--active': state.activeDropdownIndex === index }"
              role="option"
              :aria-selected="state.accountId === account.id ? 'true' : 'false'"
              @mousedown.prevent="selectAccount(account)"
            >
              <span class="account-dropdown-username">{{ account.username }}</span>
              <span class="account-dropdown-email">{{ account.email }}</span>
            </li>
          </ul>
        </div>
        <p
          v-if="state.errors.account"
          id="grant-account-error"
          class="form-error"
          role="alert"
        >
          {{ state.errors.account }}
        </p>
      </div>

      <!-- Reason -->
      <div class="form-group">
        <label class="form-label" for="grant-reason">{{ t("grants.form.reason_label") }}</label>
        <div class="textarea-wrapper">
          <textarea
            id="grant-reason"
            v-model="state.reason"
            :placeholder="t('grants.form.reason_placeholder')"
            class="form-textarea"
            :class="{ 'form-input--error': state.errors.reason }"
            rows="3"
            maxlength="500"
            :aria-invalid="state.errors.reason ? 'true' : 'false'"
            :aria-describedby="[state.errors.reason ? 'grant-reason-error' : null, 'grant-reason-counter'].filter(Boolean).join(' ')"
          />
          <p id="grant-reason-counter" class="char-counter" :class="{ 'char-counter--warning': reasonCharCount > 450 }">
            {{ t('grants.form.char_count', { current: reasonCharCount, max: 500 }) }}
          </p>
        </div>
        <p
          v-if="state.errors.reason"
          id="grant-reason-error"
          class="form-error"
          role="alert"
        >
          {{ state.errors.reason }}
        </p>
      </div>

      <!-- Expiration Date -->
      <div class="form-group">
        <label class="form-label" for="grant-expires">{{ t("grants.form.expires_label") }}</label>
        <input
          id="grant-expires"
          type="date"
          v-model="state.expiresAt"
          :min="todayDateString"
          class="form-input form-input--date"
          :class="{ 'form-input--error': state.errors.expiresAt }"
          :aria-invalid="state.errors.expiresAt ? 'true' : 'false'"
          :aria-describedby="state.errors.expiresAt ? 'grant-expires-error' : undefined"
        />
        <p
          v-if="state.errors.expiresAt"
          id="grant-expires-error"
          class="form-error"
          role="alert"
        >
          {{ state.errors.expiresAt }}
        </p>
      </div>

      <div v-if="state.errorMessage" class="message message-error" role="alert">
        {{ state.errorMessage }}
      </div>

      <div class="form-actions">
        <button type="button" class="btn-cancel" @click="$emit('close')">
          {{ t('grants.form.cancel_button') }}
        </button>
        <button
          type="submit"
          class="btn-submit"
          :disabled="state.submitting"
          :aria-disabled="state.submitting ? 'true' : undefined"
        >
          {{ t("grants.create_button") }}
        </button>
      </div>
    </form>
  </Modal>
</template>

<script setup lang="ts">
import { reactive, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import Modal from '@/client/components/common/modal.vue';
import SubscriptionService from '@/client/service/subscription';

const emit = defineEmits(['close', 'created']);
const { t } = useTranslation('admin', {
  keyPrefix: 'funding',
});

const subscriptionService = new SubscriptionService();

const state = reactive({
  accountId: '',
  accountDisplay: '',
  reason: '',
  expiresAt: '',
  submitting: false,
  errors: {} as Record<string, string>,
  errorMessage: '',
  accountSearchQuery: '',
  accountSearchResults: [] as Array<{ id: string; username: string; email: string }>,
  accountSearchLoading: false,
  showAccountDropdown: false,
  activeDropdownIndex: -1,
});

let searchTimeout: ReturnType<typeof setTimeout> | null = null;

// Computed: today's date string for date input min attribute
const todayDateString = computed(() => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
});

// Computed: reason character count
const reasonCharCount = computed(() => state.reason.length);

// Computed: ID of the currently highlighted dropdown option for aria-activedescendant
const activeDescendantId = computed(() => {
  if (!state.showAccountDropdown || state.activeDropdownIndex < 0) {
    return undefined;
  }
  return `account-option-${state.activeDropdownIndex}`;
});

/**
 * Search accounts for autocomplete
 */
async function searchAccounts() {
  const query = state.accountSearchQuery.trim();
  if (query.length < 2) {
    state.accountSearchResults = [];
    state.showAccountDropdown = false;
    state.activeDropdownIndex = -1;
    return;
  }

  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }

  searchTimeout = setTimeout(async () => {
    try {
      state.accountSearchLoading = true;
      state.showAccountDropdown = true;
      state.activeDropdownIndex = -1;
      state.accountSearchResults = await subscriptionService.searchAccounts(query);
    }
    catch (error) {
      console.error('Failed to search accounts:', error);
      state.accountSearchResults = [];
    }
    finally {
      state.accountSearchLoading = false;
    }
  }, 300);
}

/**
 * Select account from dropdown
 */
function selectAccount(account: { id: string; username: string; email: string }) {
  state.accountId = account.id;
  state.accountDisplay = account.username
    ? `${account.username} (${account.email})`
    : account.email;
  state.accountSearchQuery = state.accountDisplay;
  state.showAccountDropdown = false;
  state.activeDropdownIndex = -1;
  state.accountSearchResults = [];
  if (state.errors.account) {
    delete state.errors.account;
  }
}

/**
 * Handle account search input changes (clear selection if user modifies)
 */
function onAccountInputChange() {
  if (state.accountId && state.accountSearchQuery !== state.accountDisplay) {
    state.accountId = '';
    state.accountDisplay = '';
  }
  searchAccounts();
}

/**
 * Handle blur on account search input
 */
function handleAccountBlur() {
  window.setTimeout(() => {
    state.showAccountDropdown = false;
    state.activeDropdownIndex = -1;
  }, 200);
}

/**
 * Handle keyboard navigation in the account search combobox.
 * Supports ArrowDown, ArrowUp, Enter, and Escape.
 */
function handleAccountSearchKeydown(event: KeyboardEvent) {
  const results = state.accountSearchResults;

  if (event.key === 'Escape') {
    state.showAccountDropdown = false;
    state.activeDropdownIndex = -1;
    event.preventDefault();
    return;
  }

  if (!state.showAccountDropdown || results.length === 0) {
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    state.activeDropdownIndex = Math.min(state.activeDropdownIndex + 1, results.length - 1);
  }
  else if (event.key === 'ArrowUp') {
    event.preventDefault();
    state.activeDropdownIndex = Math.max(state.activeDropdownIndex - 1, 0);
  }
  else if (event.key === 'Enter') {
    if (state.activeDropdownIndex >= 0 && state.activeDropdownIndex < results.length) {
      event.preventDefault();
      selectAccount(results[state.activeDropdownIndex]);
    }
  }
}

/**
 * Validate grant form
 */
function validateGrantForm(): boolean {
  const errors: Record<string, string> = {};

  if (!state.accountId) {
    errors.account = t('grants.form.account_required');
  }

  if (state.reason.length > 500) {
    errors.reason = t('grants.form.reason_max_length');
  }

  if (state.expiresAt) {
    const expiresDate = new Date(state.expiresAt);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (expiresDate <= now) {
      errors.expiresAt = t('grants.form.expires_future');
    }
  }

  state.errors = errors;
  return Object.keys(errors).length === 0;
}

/**
 * Submit create grant form
 */
async function submitCreateGrant() {
  if (!validateGrantForm()) {
    return;
  }

  state.submitting = true;
  state.errorMessage = '';

  try {
    const expiresAt = state.expiresAt ? new Date(state.expiresAt) : undefined;
    const reason = state.reason.trim() || undefined;

    await subscriptionService.createGrant(state.accountId, reason, expiresAt);
    emit('created');
  }
  catch (error) {
    console.error('Failed to create grant:', error);
    state.errorMessage = t('grants.create_error');
  }
  finally {
    state.submitting = false;
  }
}
</script>

<style scoped lang="scss">
.grant-form {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);

  .form-group {
    .form-label {
      display: block;
      margin-bottom: var(--pav-space-1_5);
      font-size: var(--pav-font-size-xs);
      font-weight: var(--pav-font-weight-medium);
      color: var(--pav-color-text-secondary);
    }

    .form-required {
      color: var(--pav-color-red-500);
      margin-inline-start: var(--pav-space-1);
    }
  }

  .form-input {
    width: 100%;
    padding: var(--pav-space-2) var(--pav-space-3);
    border: 1px solid var(--pav-border-color-medium);
    border-radius: var(--pav-border-radius-md);
    background: var(--pav-color-surface-primary);
    font-size: var(--pav-font-size-sm);
    font-family: inherit;
    color: var(--pav-color-text-primary);
    box-sizing: border-box;

    &:focus {
      outline: none;
      border-color: var(--pav-color-orange-400);
      box-shadow: 0 0 0 3px var(--pav-color-orange-100);
    }

    &--error {
      border-color: var(--pav-color-red-400);

      &:focus {
        box-shadow: 0 0 0 3px var(--pav-color-red-100);
      }
    }

    &--date {
      cursor: pointer;
    }
  }

  .form-textarea {
    width: 100%;
    padding: var(--pav-space-2) var(--pav-space-3);
    border: 1px solid var(--pav-border-color-medium);
    border-radius: var(--pav-border-radius-md);
    background: var(--pav-color-surface-primary);
    font-size: var(--pav-font-size-sm);
    font-family: inherit;
    color: var(--pav-color-text-primary);
    resize: vertical;
    box-sizing: border-box;

    &:focus {
      outline: none;
      border-color: var(--pav-color-orange-400);
      box-shadow: 0 0 0 3px var(--pav-color-orange-100);
    }
  }

  .form-error {
    margin: var(--pav-space-1) 0 0;
    font-size: var(--pav-font-size-xs);
    color: var(--pav-color-red-600);
  }

  .textarea-wrapper {
    position: relative;
  }

  .char-counter {
    margin: var(--pav-space-1) 0 0;
    font-size: var(--pav-font-size-xs);
    color: var(--pav-color-text-muted);
    text-align: end;

    &--warning {
      color: var(--pav-color-amber-600);
    }
  }

  .account-search-wrapper {
    position: relative;
  }

  .account-dropdown {
    position: absolute;
    top: calc(100% + var(--pav-space-1));
    inset-inline-start: 0;
    inset-inline-end: 0;
    background: var(--pav-color-surface-primary);
    border: 1px solid var(--pav-border-color-medium);
    border-radius: var(--pav-border-radius-md);
    box-shadow: var(--pav-shadow-md);
    max-height: 240px;
    overflow-y: auto;
    z-index: 10;
    padding: 0;
    margin: 0;
    list-style: none;

    .account-dropdown-item {
      display: flex;
      flex-direction: column;
      gap: var(--pav-space-0_5);
      padding: var(--pav-space-2_5) var(--pav-space-3);
      cursor: pointer;
      transition: background-color 0.1s ease;

      &:hover,
      &--active {
        background: var(--pav-color-stone-50);
      }

      &--loading,
      &--empty {
        color: var(--pav-color-text-muted);
        font-size: var(--pav-font-size-xs);
        cursor: default;
      }

      .account-dropdown-username {
        font-size: var(--pav-font-size-sm);
        font-weight: var(--pav-font-weight-medium);
        color: var(--pav-color-text-primary);
      }

      .account-dropdown-email {
        font-size: var(--pav-font-size-xs);
        color: var(--pav-color-text-muted);
      }
    }
  }

  .message {
    padding: var(--pav-space-3) var(--pav-space-4);
    border-radius: var(--pav-border-radius-md);
    font-size: var(--pav-font-size-xs);

    &.message-error {
      background: var(--pav-color-red-50);
      border: 1px solid var(--pav-color-red-200);
      color: var(--pav-color-red-700);
    }
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--pav-space-3);
    padding-top: var(--pav-space-4);
    border-top: 1px solid var(--pav-border-color-light);

    .btn-cancel {
      padding: var(--pav-space-2) var(--pav-space-5);
      background: none;
      border: 1px solid var(--pav-border-color-medium);
      border-radius: var(--pav-border-radius-full);
      color: var(--pav-color-text-secondary);
      font-weight: var(--pav-font-weight-medium);
      font-size: var(--pav-font-size-xs);
      font-family: inherit;
      cursor: pointer;
      transition: background-color 0.2s ease;

      &:hover {
        background: var(--pav-color-stone-50);
      }
    }

    .btn-submit {
      padding: var(--pav-space-2) var(--pav-space-6);
      background: var(--pav-color-brand-primary);
      border: none;
      border-radius: var(--pav-border-radius-full);
      color: var(--pav-color-text-inverse);
      font-weight: var(--pav-font-weight-medium);
      font-size: var(--pav-font-size-xs);
      font-family: inherit;
      cursor: pointer;
      transition: background-color 0.2s ease;

      &:hover:not(:disabled) {
        background: var(--pav-color-brand-primary-dark);
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }
  }
}
</style>
