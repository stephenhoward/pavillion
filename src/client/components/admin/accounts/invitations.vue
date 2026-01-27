<template>
  <section class="invitations-section">
    <!-- Status Messages -->
    <div v-if="state.successMessage"
         class="message message-success"
         role="status"
         aria-live="polite">
      <svg class="message-icon"
           width="16"
           height="16"
           viewBox="0 0 24 24"
           fill="none"
           stroke="currentColor"
           stroke-width="2"
           stroke-linecap="round"
           stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      {{ state.successMessage }}
    </div>
    <div v-if="state.errorMessage"
         class="message message-error"
         role="alert"
         aria-live="polite">
      <svg class="message-icon"
           width="16"
           height="16"
           viewBox="0 0 24 24"
           fill="none"
           stroke="currentColor"
           stroke-width="2"
           stroke-linecap="round"
           stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="15"
              y1="9"
              x2="9"
              y2="15"/>
        <line x1="9"
              y1="9"
              x2="15"
              y2="15"/>
      </svg>
      {{ state.errorMessage }}
    </div>

    <!-- Active Invitations Card -->
    <div class="invitations-card">
      <div class="card-header">
        <h3>{{ t('active_title') }}</h3>
      </div>

      <div v-if="activeInvitations.length === 0" class="empty-state">
        <svg width="48"
             height="48"
             viewBox="0 0 24 24"
             fill="none"
             stroke="currentColor"
             stroke-width="1.5"
             stroke-linecap="round"
             stroke-linejoin="round"
             class="empty-icon">
          <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <p class="empty-text">{{ t('no_invitations') }}</p>
        <button type="button" class="send-invitation-link" @click="openInviteForm">
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
          {{ t('send_invitation_link') }}
        </button>
      </div>

      <template v-else>
        <!-- Desktop Table -->
        <div class="invitations-table-desktop">
          <table class="invitations-table">
            <thead>
              <tr>
                <th scope="col">{{ t('email_column') }}</th>
                <th scope="col">{{ t('invited_by_column') }}</th>
                <th scope="col">{{ t('expiry_column') }}</th>
                <th scope="col" class="col-actions">{{ t('actions_column') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="invitation in activeInvitations" :key="invitation.id">
                <td class="cell-email">{{ invitation.email }}</td>
                <td class="cell-secondary">{{ invitation.invitedBy ? invitation.invitedBy.username || invitation.invitedBy : '' }}</td>
                <td class="cell-date">{{ formatDate(invitation.expirationTime) }}</td>
                <td class="cell-actions">
                  <button type="button" class="action-link-resend" @click="resendInvitation(invitation)">
                    {{ t('resend') }}
                  </button>
                  <button type="button" class="action-link-cancel" @click="cancelInvitation(invitation)">
                    {{ t('cancel') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Mobile Cards -->
        <div class="invitations-mobile">
          <div v-for="invitation in activeInvitations" :key="invitation.id" class="invitation-card">
            <div class="invitation-card-info">
              <p class="invitation-card-email">{{ invitation.email }}</p>
              <p class="invitation-card-meta">
                {{ t('invited_by_expires', {
                  username: invitation.invitedBy ? invitation.invitedBy.username || invitation.invitedBy : '',
                  date: formatDate(invitation.expirationTime)
                }) }}
              </p>
            </div>
            <div class="invitation-card-actions">
              <button type="button" class="action-button-resend" @click="resendInvitation(invitation)">
                {{ t('resend') }}
              </button>
              <button type="button" class="action-button-cancel" @click="cancelInvitation(invitation)">
                {{ t('cancel') }}
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Expired Invitations Card -->
    <div v-if="expiredInvitations.length > 0" class="invitations-card invitations-card--expired">
      <div class="card-header">
        <h3>{{ t('expired_title') }}</h3>
      </div>

      <!-- Desktop Table -->
      <div class="invitations-table-desktop">
        <table class="invitations-table">
          <tbody>
            <tr v-for="invitation in expiredInvitations" :key="invitation.id">
              <td class="cell-expired-email">{{ invitation.email }}</td>
              <td class="cell-expired-secondary">{{ invitation.invitedBy ? invitation.invitedBy.username || invitation.invitedBy : '' }}</td>
              <td>
                <span class="expired-badge">{{ t('expired_date', { date: formatDate(invitation.expirationTime) }) }}</span>
              </td>
              <td class="cell-actions">
                <button type="button" class="action-link-remove" @click="cancelInvitation(invitation)">
                  {{ t('remove') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile Cards -->
      <div class="invitations-mobile">
        <div v-for="invitation in expiredInvitations" :key="invitation.id" class="invitation-card invitation-card--expired">
          <div class="invitation-card-info">
            <p class="cell-expired-email">{{ invitation.email }}</p>
            <p class="invitation-card-meta-expired">{{ t('expired_date', { date: formatDate(invitation.expirationTime) }) }}</p>
          </div>
          <button type="button" class="action-button-remove" @click="cancelInvitation(invitation)">
            {{ t('remove') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Invite Form Modal -->
    <InviteFormView
      v-if="state.inviteFormOpen"
      @close="state.inviteFormOpen = false"
      @invited="onInvited"
    />
  </section>
</template>

<script setup>
import { reactive, computed, onBeforeMount, inject } from 'vue';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import { useInvitationStore } from '@/client/stores/invitationStore';
import InviteFormView from './invite_form.vue';
import ModelService from '@/client/service/models';

const store = useInvitationStore();
const authn = inject('authn');
const { t } = useTranslation('admin', {
  keyPrefix: 'invitations',
});

const state = reactive({
  inviteFormOpen: false,
  successMessage: null,
  errorMessage: null,
});

onBeforeMount(async () => {
  await loadInvitations();
});

const loadInvitations = async () => {
  try {
    const response = await ModelService.listModels('/api/v1/admin/invitations');
    store.invitations = response;
  }
  catch (error) {
    console.error('Error loading invitations:', error);
  }
};

const isExpired = (invitation) => {
  if (!invitation.expirationTime) return false;
  return new Date(invitation.expirationTime) < new Date();
};

const activeInvitations = computed(() => {
  if (!store.invitations) return [];
  return store.invitations.filter(inv => !isExpired(inv));
});

const expiredInvitations = computed(() => {
  if (!store.invitations) return [];
  return store.invitations.filter(inv => isExpired(inv));
});

const formatDate = (date) => {
  if (!date) return t('unknown_expiration');
  const dt = typeof date === 'string' ? DateTime.fromISO(date) : DateTime.fromJSDate(new Date(date));
  return dt.toLocaleString({ month: 'short', day: 'numeric', year: 'numeric' });
};

const openInviteForm = () => {
  state.inviteFormOpen = true;
};

const onInvited = async () => {
  state.inviteFormOpen = false;
  await loadInvitations();
};

const resendInvitation = async (invitation) => {
  try {
    await authn.resend_invitation(invitation.id);
    state.successMessage = t('resend_success', { email: invitation.email });
    setTimeout(() => {
      state.successMessage = null;
    }, 3000);
  }
  catch (error) {
    console.error('Error resending invitation:', error);
    state.errorMessage = t('resend_error', { email: invitation.email });
    setTimeout(() => {
      state.errorMessage = null;
    }, 3000);
  }
};

const cancelInvitation = async (invitation) => {
  try {
    await authn.revoke_invitation(invitation.id);
    store.removeInvitation(invitation);
    state.successMessage = t('revoke_success');
    setTimeout(() => {
      state.successMessage = null;
    }, 3000);
  }
  catch (error) {
    console.error('Error revoking invitation:', error);
    state.errorMessage = t('revoke_error');
    setTimeout(() => {
      state.errorMessage = null;
    }, 3000);
  }
};
</script>

<style scoped lang="scss">
@use '../../../assets/style/tokens/breakpoints' as *;

.invitations-section {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-6);

  .message {
    display: flex;
    align-items: center;
    gap: var(--pav-space-2);
    padding: var(--pav-space-3) var(--pav-space-4);
    border-radius: var(--pav-border-radius-md);
    font-size: var(--pav-font-size-xs);

    .message-icon {
      flex-shrink: 0;
    }

    &.message-success {
      background: var(--pav-color-emerald-50);
      border: 1px solid var(--pav-color-emerald-200);
      color: var(--pav-color-emerald-800);
    }

    &.message-error {
      background: var(--pav-color-red-50);
      border: 1px solid var(--pav-color-red-200);
      color: var(--pav-color-red-700);
    }
  }

  .invitations-card {
    background: var(--pav-color-surface-primary);
    border-radius: var(--pav-border-radius-xl);
    border: 1px solid var(--pav-border-color-light);
    overflow: hidden;

    &--expired {
      opacity: 0.75;
    }

    .card-header {
      padding: var(--pav-space-4) var(--pav-space-6);
      border-bottom: 1px solid var(--pav-border-color-light);

      h3 {
        margin: 0;
        font-weight: var(--pav-font-weight-medium);
        color: var(--pav-color-text-primary);
        font-size: var(--pav-font-size-sm);
      }
    }

    .empty-state {
      padding: var(--pav-space-12);
      text-align: center;

      .empty-icon {
        margin: 0 auto var(--pav-space-4);
        display: block;
        color: var(--pav-color-stone-300);
      }

      .empty-text {
        margin: 0 0 var(--pav-space-4);
        color: var(--pav-color-text-muted);
      }

      .send-invitation-link {
        display: inline-flex;
        align-items: center;
        gap: var(--pav-space-2);
        padding: var(--pav-space-2) var(--pav-space-4);
        background: none;
        border: none;
        color: var(--pav-color-orange-600);
        font-weight: var(--pav-font-weight-medium);
        font-family: inherit;
        cursor: pointer;
        transition: color 0.2s ease;

        &:hover {
          color: var(--pav-color-orange-700);
        }
      }
    }

    .invitations-table-desktop {
      display: none;

      @include pav-media(md) {
        display: block;
      }

      .invitations-table {
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

          .cell-email {
            font-weight: var(--pav-font-weight-medium);
            color: var(--pav-color-text-primary);
          }

          .cell-secondary {
            color: var(--pav-color-text-secondary);
          }

          .cell-date {
            color: var(--pav-color-text-secondary);
            font-size: var(--pav-font-size-xs);
          }

          .cell-expired-email {
            color: var(--pav-color-text-muted);
          }

          .cell-expired-secondary {
            color: var(--pav-color-stone-400);
          }

          .cell-actions {
            text-align: right;
            white-space: nowrap;
          }
        }
      }
    }

    .invitations-mobile {
      display: block;

      @include pav-media(md) {
        display: none;
      }

      .invitation-card {
        padding: var(--pav-space-4);
        border-bottom: 1px solid var(--pav-border-color-light);
        display: flex;
        flex-direction: column;
        gap: var(--pav-space-3);

        &:last-child {
          border-bottom: none;
        }

        &--expired {
          flex-direction: row;
          align-items: center;
          justify-content: space-between;
          gap: var(--pav-space-3);
        }

        .invitation-card-info {
          min-width: 0;
          flex: 1;

          .invitation-card-email {
            margin: 0;
            font-weight: var(--pav-font-weight-medium);
            color: var(--pav-color-text-primary);
            word-break: break-all;
          }

          .invitation-card-meta {
            margin: var(--pav-space-1) 0 0 0;
            font-size: var(--pav-font-size-xs);
            color: var(--pav-color-text-muted);
          }

          .invitation-card-meta-expired {
            margin: var(--pav-space-1) 0 0 0;
            font-size: var(--pav-font-size-xs);
            color: var(--pav-color-stone-400);
          }
        }

        .invitation-card-actions {
          display: flex;
          gap: var(--pav-space-2);
        }
      }
    }
  }

  .expired-badge {
    display: inline-flex;
    align-items: center;
    padding: var(--pav-space-1) var(--pav-space-2_5);
    border-radius: var(--pav-border-radius-full);
    font-size: var(--pav-font-size-2xs);
    font-weight: var(--pav-font-weight-medium);
    background: var(--pav-color-stone-100);
    color: var(--pav-color-text-muted);
  }

  .action-link-resend {
    background: none;
    border: none;
    color: var(--pav-color-orange-600);
    font-size: var(--pav-font-size-xs);
    font-weight: var(--pav-font-weight-medium);
    font-family: inherit;
    cursor: pointer;
    padding: 0;
    margin-right: var(--pav-space-3);
    transition: color 0.2s ease;

    &:hover {
      color: var(--pav-color-orange-700);
    }
  }

  .action-link-cancel {
    background: none;
    border: none;
    color: var(--pav-color-red-600);
    font-size: var(--pav-font-size-xs);
    font-weight: var(--pav-font-weight-medium);
    font-family: inherit;
    cursor: pointer;
    padding: 0;
    transition: color 0.2s ease;

    &:hover {
      color: var(--pav-color-red-700);
    }
  }

  .action-link-remove {
    background: none;
    border: none;
    color: var(--pav-color-stone-400);
    font-size: var(--pav-font-size-xs);
    font-weight: var(--pav-font-weight-medium);
    font-family: inherit;
    cursor: pointer;
    padding: 0;
    transition: color 0.2s ease;

    &:hover {
      color: var(--pav-color-text-secondary);
    }
  }

  .action-button-resend {
    flex: 1;
    padding: var(--pav-space-2) var(--pav-space-4);
    font-size: var(--pav-font-size-xs);
    font-weight: var(--pav-font-weight-medium);
    font-family: inherit;
    color: var(--pav-color-orange-600);
    background: none;
    border: 1px solid var(--pav-color-orange-200);
    border-radius: var(--pav-border-radius-full);
    cursor: pointer;
    transition: background-color 0.2s ease;

    &:hover {
      background: var(--pav-color-orange-50);
    }
  }

  .action-button-cancel {
    flex: 1;
    padding: var(--pav-space-2) var(--pav-space-4);
    font-size: var(--pav-font-size-xs);
    font-weight: var(--pav-font-weight-medium);
    font-family: inherit;
    color: var(--pav-color-red-600);
    background: none;
    border: 1px solid var(--pav-color-red-200);
    border-radius: var(--pav-border-radius-full);
    cursor: pointer;
    transition: background-color 0.2s ease;

    &:hover {
      background: var(--pav-color-red-50);
    }
  }

  .action-button-remove {
    flex-shrink: 0;
    padding: var(--pav-space-1_5) var(--pav-space-3);
    font-size: var(--pav-font-size-xs);
    font-weight: var(--pav-font-weight-medium);
    font-family: inherit;
    color: var(--pav-color-text-muted);
    background: none;
    border: none;
    border-radius: var(--pav-border-radius-full);
    cursor: pointer;
    transition: color 0.2s ease, background-color 0.2s ease;

    &:hover {
      color: var(--pav-color-text-secondary);
      background: var(--pav-color-stone-100);
    }
  }
}

@media (prefers-color-scheme: dark) {
  .invitations-section {
    .message {
      &.message-success {
        background: rgba(16, 185, 129, 0.1);
        border-color: rgba(16, 185, 129, 0.3);
        color: var(--pav-color-emerald-300);
      }

      &.message-error {
        background: rgba(239, 68, 68, 0.1);
        border-color: rgba(239, 68, 68, 0.3);
        color: var(--pav-color-red-300);
      }
    }

    .invitations-card {
      .card-header h3 {
        color: var(--pav-color-text-primary);
      }

      .empty-state {
        .empty-icon {
          color: var(--pav-color-stone-600);
        }

        .send-invitation-link {
          color: var(--pav-color-orange-400);

          &:hover {
            color: var(--pav-color-orange-300);
          }
        }
      }

      .invitations-table-desktop {
        .invitations-table {
          thead tr {
            background: rgba(41, 37, 36, 0.5);
          }

          tbody tr:hover {
            background: rgba(41, 37, 36, 0.3);
          }
        }
      }
    }

    .expired-badge {
      background: var(--pav-color-stone-800);
      color: var(--pav-color-stone-400);
    }

    .action-link-resend {
      color: var(--pav-color-orange-400);

      &:hover {
        color: var(--pav-color-orange-300);
      }
    }

    .action-link-cancel {
      color: var(--pav-color-red-400);

      &:hover {
        color: var(--pav-color-red-300);
      }
    }

    .action-link-remove {
      color: var(--pav-color-stone-500);

      &:hover {
        color: var(--pav-color-stone-300);
      }
    }

    .action-button-resend {
      color: var(--pav-color-orange-400);
      border-color: var(--pav-color-orange-800);

      &:hover {
        background: rgba(249, 115, 22, 0.1);
      }
    }

    .action-button-cancel {
      color: var(--pav-color-red-400);
      border-color: var(--pav-color-red-800);

      &:hover {
        background: rgba(239, 68, 68, 0.1);
      }
    }

    .action-button-remove {
      color: var(--pav-color-stone-400);

      &:hover {
        color: var(--pav-color-stone-200);
        background: var(--pav-color-stone-800);
      }
    }
  }
}
</style>
