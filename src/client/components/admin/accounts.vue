<script setup>
import { reactive, computed, nextTick, onBeforeMount, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import InvitationsView from './accounts/invitations.vue';
import ApplicationsView from './accounts/applications.vue';
import ModelService from '@/client/service/models';
import EmptyLayout from '@/client/components/common/empty_state.vue';
import LoadingMessage from '@/client/components/common/loading_message.vue';
import { useApplicationStore } from '@/client/stores/applicationStore';
import { useInvitationStore } from '@/client/stores/invitationStore';
import { DateTime } from 'luxon';

const { t } = useTranslation('admin', {
  keyPrefix: 'accounts',
});

const applicationStore = useApplicationStore();
const invitationStore = useInvitationStore();

const accounts = ref([]);

const state = reactive({
  activeTab: 'accounts',
  isLoading: false,
});

const invitationsViewRef = ref(null);

onBeforeMount(async () => {
  await loadAccounts();
});

async function loadAccounts() {
  state.isLoading = true;
  try {
    const response = await ModelService.listModels('/api/v1/admin/accounts');
    accounts.value = response;
  }
  catch (error) {
    console.error('Error loading accounts:', error);
  }
  finally {
    state.isLoading = false;
  }
}

const activateTab = (tab) => {
  state.activeTab = tab;
  nextTick(() => {
    const panel = document.getElementById(`${tab}-panel`);
    if (panel) {
      panel.focus();
    }
  });
};

/**
 * Formats a date string or Date object for display.
 */
const formatDate = (date) => {
  if (!date) return '';
  const dt = typeof date === 'string' ? DateTime.fromISO(date) : DateTime.fromJSDate(new Date(date));
  return dt.toLocaleString({ month: 'short', day: 'numeric', year: 'numeric' });
};

/**
 * Computed counts for tab badges.
 */
const accountCount = computed(() => accounts.value.length);
const pendingApplicationCount = computed(() => {
  if (!applicationStore.applications) return 0;
  return applicationStore.applications.filter(a => a.status === 'pending').length;
});
const activeInvitationCount = computed(() => {
  if (!invitationStore.invitations) return 0;
  return invitationStore.invitations.filter(inv => {
    if (!inv.expirationTime) return false;
    return new Date(inv.expirationTime) > new Date();
  }).length;
});

const subTabs = computed(() => [
  { id: 'accounts', label: t('accounts_tab'), count: accountCount.value },
  { id: 'applications', label: t('applications_tab'), count: pendingApplicationCount.value },
  { id: 'invitations', label: t('invitations_tab'), count: activeInvitationCount.value },
]);
</script>

<template>
  <section id="accounts" class="accounts-page" aria-labelledby="accounts-heading">
    <!-- Page Header -->
    <div class="page-header">
      <div class="page-header-text">
        <h1 id="accounts-heading">{{ t('page_title') }}</h1>
        <p class="page-subtitle">{{ t('page_subtitle') }}</p>
      </div>
      <button
        v-if="state.activeTab === 'invitations'"
        type="button"
        class="invite-button"
        @click="invitationsViewRef?.openInviteForm()"
      >
        <svg width="20"
             height="20"
             viewBox="0 0 24 24"
             fill="none"
             stroke="currentColor"
             stroke-width="2"
             stroke-linecap="round"
             stroke-linejoin="round">
          <path d="M12 4v16m8-8H4" />
        </svg>
        {{ t('inviteNewAccount') }}
      </button>
    </div>

    <!-- Sub-Tab Navigation -->
    <div class="subtab-border">
      <nav role="tablist" aria-label="Account management sections" class="subtab-nav">
        <button
          v-for="tab in subTabs"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="state.activeTab === tab.id ? 'true' : 'false'"
          :aria-controls="`${tab.id}-panel`"
          class="subtab"
          :class="{ 'subtab--active': state.activeTab === tab.id }"
          @click="activateTab(tab.id)"
        >
          {{ tab.label }}
          <span
            v-if="tab.count !== undefined"
            class="subtab-badge"
            :class="{ 'subtab-badge--active': state.activeTab === tab.id }"
          >
            {{ tab.count }}
          </span>
        </button>
      </nav>
    </div>

    <!-- Accounts Tab Panel -->
    <section
      id="accounts-panel"
      role="tabpanel"
      aria-labelledby="accounts-tab"
      :aria-hidden="state.activeTab === 'accounts' ? 'false' : 'true'"
      :hidden="state.activeTab !== 'accounts'"
      class="tab-panel"
    >
      <LoadingMessage v-if="state.isLoading" :description="t('loading')" />
      <div v-else-if="accounts && accounts.length > 0" class="accounts-card">
        <!-- Desktop Table -->
        <div class="accounts-table-desktop">
          <table class="accounts-table" role="table" aria-label="User accounts">
            <thead>
              <tr>
                <th scope="col">{{ t('name_column') }}</th>
                <th scope="col">{{ t('email_column') }}</th>
                <th scope="col">{{ t('role_column') }}</th>
                <th scope="col">{{ t('joined_column') }}</th>
                <th scope="col" class="col-actions">{{ t('actions_column') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="account in accounts" :key="account.id">
                <td class="cell-name">{{ account.displayName || account.username }}</td>
                <td class="cell-email">{{ account.email }}</td>
                <td class="cell-roles">
                  <span v-if="account.role" class="role-badge">{{ account.role }}</span>
                  <span v-else class="no-role">{{ t('no_role') }}</span>
                </td>
                <td class="cell-date">{{ formatDate(account.createdAt) }}</td>
                <td class="cell-actions">
                  <button type="button" class="action-link">{{ t('view_action') }}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Mobile Cards -->
        <div class="accounts-mobile">
          <div v-for="account in accounts" :key="account.id" class="account-card">
            <div class="account-card-header">
              <div class="account-card-info">
                <p class="account-card-name">{{ account.displayName || account.username }}</p>
                <p class="account-card-email">{{ account.email }}</p>
              </div>
              <button type="button" class="action-link-mobile">{{ t('view_action') }}</button>
            </div>
            <div class="account-card-meta">
              <span v-if="account.role" class="role-badge">{{ account.role }}</span>
              <span class="account-card-joined">{{ t('joined_column') }} {{ formatDate(account.createdAt) }}</span>
            </div>
          </div>
        </div>
      </div>
      <EmptyLayout v-else :title="t('noAccounts')" :description="t('noAccountsDescription')">
        <button type="button" class="invite-button" @click="activateTab('invitations')">
          {{ t('inviteNewAccount') }}
        </button>
      </EmptyLayout>
    </section>

    <!-- Applications Tab Panel -->
    <section
      id="applications-panel"
      role="tabpanel"
      aria-labelledby="applications-tab"
      :aria-hidden="state.activeTab === 'applications' ? 'false' : 'true'"
      :hidden="state.activeTab !== 'applications'"
      class="tab-panel"
    >
      <ApplicationsView />
    </section>

    <!-- Invitations Tab Panel -->
    <section
      id="invitations-panel"
      role="tabpanel"
      aria-labelledby="invitations-tab"
      :aria-hidden="state.activeTab === 'invitations' ? 'false' : 'true'"
      :hidden="state.activeTab !== 'invitations'"
      class="tab-panel"
    >
      <InvitationsView ref="invitationsViewRef" />
    </section>
  </section>
</template>

<style scoped lang="scss">
@use '../../assets/style/tokens/breakpoints' as *;

.accounts-page {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-6);

  .page-header {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-4);

    @include pav-media(sm) {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }

    .page-header-text {
      h1 {
        margin: 0 0 var(--pav-space-1) 0;
        font-size: var(--pav-font-size-2xl);
        font-weight: var(--pav-font-weight-light);
        color: var(--pav-color-text-primary);
      }

      .page-subtitle {
        margin: 0;
        font-size: var(--pav-font-size-xs);
        color: var(--pav-color-text-muted);
      }
    }

    .invite-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--pav-space-2);
      padding: var(--pav-space-2_5) var(--pav-space-6);
      background: var(--pav-color-brand-primary);
      color: var(--pav-color-text-inverse);
      font-weight: var(--pav-font-weight-medium);
      font-size: var(--pav-font-size-xs);
      font-family: inherit;
      border: none;
      border-radius: var(--pav-border-radius-full);
      cursor: pointer;
      transition: background-color 0.2s ease;
      width: 100%;

      @include pav-media(sm) {
        width: auto;
      }

      &:hover {
        background: var(--pav-color-brand-primary-dark);
      }

      &:focus-visible {
        outline: 2px solid var(--pav-color-brand-primary);
        outline-offset: 2px;
      }
    }
  }

  .subtab-border {
    border-bottom: 1px solid var(--pav-border-color-light);
    margin: 0 calc(-1 * var(--pav-space-4));
    padding: 0 var(--pav-space-4);

    @include pav-media(md) {
      margin: 0;
      padding: 0;
    }

    .subtab-nav {
      display: flex;
      gap: var(--pav-space-4);
      overflow-x: auto;

      @include pav-media(sm) {
        gap: var(--pav-space-6);
      }

      .subtab {
        padding-bottom: var(--pav-space-3);
        font-size: var(--pav-font-size-xs);
        font-weight: var(--pav-font-weight-medium);
        font-family: inherit;
        border: none;
        border-bottom: 2px solid transparent;
        background: none;
        color: var(--pav-color-text-muted);
        cursor: pointer;
        white-space: nowrap;
        flex-shrink: 0;
        transition: color 0.2s ease, border-color 0.2s ease;

        &:hover {
          color: var(--pav-color-text-secondary);
        }

        &--active {
          border-bottom-color: var(--pav-color-orange-500);
          color: var(--pav-color-orange-600);
        }

        .subtab-badge {
          margin-left: var(--pav-space-2);
          padding: var(--pav-space-0_5) var(--pav-space-2);
          border-radius: var(--pav-border-radius-full);
          font-size: var(--pav-font-size-2xs);
          background: var(--pav-color-stone-100);
          color: var(--pav-color-text-muted);

          &--active {
            background: var(--pav-color-orange-100);
            color: var(--pav-color-orange-600);
          }
        }
      }
    }
  }

  .tab-panel {
    outline: none;
  }

  .accounts-card {
    background: var(--pav-color-surface-primary);
    border-radius: var(--pav-border-radius-xl);
    border: 1px solid var(--pav-border-color-light);
    overflow: hidden;

    .accounts-table-desktop {
      display: none;

      @include pav-media(md) {
        display: block;
      }

      .accounts-table {
        width: 100%;
        border-collapse: collapse;

        thead {
          tr {
            border-bottom: 1px solid var(--pav-border-color-light);
            background: var(--pav-color-stone-50);
          }

          th {
            padding: var(--pav-space-3) var(--pav-space-6);
            text-align: left;
            font-size: var(--pav-font-size-2xs);
            font-weight: var(--pav-font-weight-semibold);
            color: var(--pav-color-text-muted);
            text-transform: uppercase;
            letter-spacing: var(--pav-letter-spacing-wider);

            &.col-actions {
              text-align: right;
            }
          }
        }

        tbody {
          tr {
            border-bottom: 1px solid var(--pav-border-color-light);
            transition: background-color 0.15s ease;

            &:last-child {
              border-bottom: none;
            }

            &:hover {
              background: var(--pav-color-stone-50);
            }
          }

          td {
            padding: var(--pav-space-4) var(--pav-space-6);
          }

          .cell-name {
            font-weight: var(--pav-font-weight-medium);
            color: var(--pav-color-text-primary);
          }

          .cell-email {
            color: var(--pav-color-text-secondary);
          }

          .cell-date {
            color: var(--pav-color-text-secondary);
            font-size: var(--pav-font-size-xs);
          }

          .cell-actions {
            text-align: right;
          }
        }
      }
    }

    .accounts-mobile {
      display: block;

      @include pav-media(md) {
        display: none;
      }

      .account-card {
        padding: var(--pav-space-4);
        border-bottom: 1px solid var(--pav-border-color-light);

        &:last-child {
          border-bottom: none;
        }

        .account-card-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--pav-space-3);

          .account-card-info {
            min-width: 0;
            flex: 1;

            .account-card-name {
              margin: 0;
              font-weight: var(--pav-font-weight-medium);
              color: var(--pav-color-text-primary);
            }

            .account-card-email {
              margin: 0;
              font-size: var(--pav-font-size-xs);
              color: var(--pav-color-text-muted);
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }
          }
        }

        .account-card-meta {
          display: flex;
          align-items: center;
          gap: var(--pav-space-3);
          margin-top: var(--pav-space-2);
          font-size: var(--pav-font-size-xs);

          .account-card-joined {
            color: var(--pav-color-stone-400);
          }
        }
      }
    }
  }

  .role-badge {
    display: inline-block;
    padding: var(--pav-space-0_5) var(--pav-space-2);
    background: var(--pav-color-sky-100);
    color: var(--pav-color-sky-700);
    font-size: var(--pav-font-size-2xs);
    font-weight: var(--pav-font-weight-medium);
    border-radius: var(--pav-border-radius-xs);
  }

  .no-role {
    color: var(--pav-color-stone-400);
    font-size: var(--pav-font-size-xs);
  }

  .action-link,
  .action-link-mobile {
    background: none;
    border: none;
    color: var(--pav-color-orange-600);
    font-size: var(--pav-font-size-xs);
    font-weight: var(--pav-font-weight-medium);
    font-family: inherit;
    cursor: pointer;
    padding: 0;
    transition: color 0.2s ease;

    &:hover {
      color: var(--pav-color-orange-700);
    }
  }

  .action-link-mobile {
    flex-shrink: 0;
    padding: var(--pav-space-1_5) var(--pav-space-3);
    border-radius: var(--pav-border-radius-full);
    transition: color 0.2s ease, background-color 0.2s ease;

    &:hover {
      background: var(--pav-color-orange-50);
    }
  }
}

@media (prefers-color-scheme: dark) {
  .accounts-page {
    .subtab-border {
      .subtab-nav {
        .subtab {
          &--active {
            color: var(--pav-color-orange-400);
          }

          &:hover {
            color: var(--pav-color-stone-300);
          }

          .subtab-badge {
            background: var(--pav-color-stone-800);
            color: var(--pav-color-stone-400);

            &--active {
              background: rgba(249, 115, 22, 0.15);
              color: var(--pav-color-orange-300);
            }
          }
        }
      }
    }

    .accounts-card {
      .accounts-table-desktop {
        .accounts-table {
          thead tr {
            background: rgba(41, 37, 36, 0.5);
          }

          tbody tr:hover {
            background: rgba(41, 37, 36, 0.3);
          }
        }
      }
    }

    .role-badge {
      background: rgba(14, 165, 233, 0.15);
      color: var(--pav-color-sky-300);
    }

    .no-role {
      color: var(--pav-color-stone-500);
    }

    .action-link,
    .action-link-mobile {
      color: var(--pav-color-orange-400);

      &:hover {
        color: var(--pav-color-orange-300);
      }
    }

    .action-link-mobile {
      &:hover {
        background: rgba(249, 115, 22, 0.1);
      }
    }
  }
}
</style>
