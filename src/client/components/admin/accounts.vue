<script setup>
import { reactive, nextTick, onBeforeMount, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import InvitationsView from './accounts/invitations.vue';
import ApplicationsView from './accounts/applications.vue';
import ModelService from '../../service/models';

const { t } = useTranslation('admin', {
  keyPrefix: 'accounts',
});

const accounts = ref([]);

const state = reactive({
  activeTab: 'accounts',
  isLoading: false,
});

onBeforeMount(async () => {
  await loadAccounts();
});

async function loadAccounts() {
  state.isLoading = true;
  try {
    const fetchedAccounts = await ModelService.listModels('/api/accounts/v1/accounts');
    accounts.value = fetchedAccounts;
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
</script>

<template>
  <div id="accounts">
    <div role="tablist">
      <button
        type="button"
        role="tab"
        :aria-selected=" state.activeTab === 'accounts' ? 'true' : 'false'"
        aria-controls="accounts-panel"
        class="tab"
        :class="{ 'active-tab': state.activeTab === 'accounts' }"
        @click="activateTab('accounts')"
      >
        {{ t('accounts_tab') }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected=" state.activeTab === 'applications' ? 'true' : 'false'"
        aria-controls="applications-panel"
        class="tab"
        :class="{ 'active-tab': state.activeTab === 'applications' }"
        @click="activateTab('applications')"
      >
        {{ t('applications_tab') }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected=" state.activeTab === 'invitations' ? 'true' : 'false'"
        aria-controls="invitations-panel"
        class="tab"
        :class="{ 'active-tab': state.activeTab === 'invitations' }"
        @click="activateTab('invitations')"
      >
        {{ t('invitations_tab') }}
      </button>
    </div>
    <div id="accounts-panel"
         role="tabpanel"
         aria-labelledby="accounts-tab"
         :aria-hidden="state.activeTab == 'accounts' ? 'true' : 'false'"
         :hidden="state.activeTab !== 'accounts'"
         class="tab-panel"
    >
      <div v-if="state.isLoading" class="loading-indicator">
        {{ t('loading') }}
      </div>
      <div v-else-if="accounts && accounts.length > 0">
        <h3>{{ t('accounts_title') }}</h3>
        <table>
          <thead>
            <tr>
              <th scope="col">{{ t('name_column') }}</th>
              <th scope="col">{{ t('email_column') }}</th>
              <th scope="col">{{ t('role_column') }}</th>
              <th scope="col">{{ t('actions_column') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="account in accounts" :key="account.id">
              <td>{{ account.displayName || account.username }}</td>
              <td>{{ account.email }}</td>
              <td>{{ account.role }}</td>
              <td>
                <!-- Actions would go here -->
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty-screen">
        <h2>{{ t('noAccounts') }}</h2>
        <p>{{ t('noAccountsDescription') }}</p>
        <button type="button" class="primary" @click="activateTab('invitations')">
          {{ t('inviteNewAccount') }}
        </button>
      </div>
    </div>
    <div
      id="applications-panel"
      role="tabpanel"
      aria-labelledby="applications-tab"
      :aria-hidden="state.activeTab == 'applications' ? 'true' : 'false'"
      :hidden="state.activeTab !== 'applications'"
      class="tab-panel"
    >
      <ApplicationsView />
    </div>
    <div
      id="invitations-panel"
      role="tabpanel"
      aria-labelledby="invitations-tab"
      :aria-hidden="state.activeTab == 'invitations' ? 'true' : 'false'"
      :hidden="state.activeTab !== 'invitations'"
      class="tab-panel"
    >
      <InvitationsView />
    </div>
  </div>
</template>

<style lang="scss">
@use '../../assets/mixins' as *;

#accounts {
  margin: 20px;
  .success-message {
    color: green;
    padding: 10px;
    margin-bottom: 10px;
    background-color: #e8f5e9;
    border: 1px solid green;
    border-radius: 4px;
  }

  .error-message {
    color: red;
    padding: 10px;
    margin-bottom: 10px;
    background-color: #ffebee;
    border: 1px solid red;
    border-radius: 4px;
  }

  .empty-screen {
    @include empty-screen;
  }

  .loading-indicator {
    text-align: center;
    padding: 20px;
    color: var(--secondary-text-color);
  }

  section {
    margin-top: 40px;
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;

      th, td {
        padding: 12px;
        text-align: left;
        border-bottom: 1px solid;
        border-bottom-color: rgba(200,200,200,.5);
      }
    }

    .status-pending {
      color: #FF9800;
      font-weight: bold;
    }

    .status-rejected {
      color: #F44336;
      font-weight: bold;
    }
  }
}
</style>
