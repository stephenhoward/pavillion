<script setup>
import { reactive, nextTick, onBeforeMount, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import InvitationsView from './accounts/invitations.vue';
import ApplicationsView from './accounts/applications.vue';
import ModelService from '@/client/service/models';
import EmptyLayout from '@/client/components/common/empty_state.vue';
import LoadingMessage from '@/client/components/common/loading_message.vue';

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
  <section id="accounts" aria-labelledby="accounts-heading">
    <h2 id="accounts-heading" class="sr-only">{{ t('accounts_title') }}</h2>
    <div role="tablist" aria-label="Account management sections">
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
    <section id="accounts-panel"
             role="tabpanel"
             aria-labelledby="accounts-tab"
             :aria-hidden="state.activeTab == 'accounts' ? 'false' : 'true'"
             :hidden="state.activeTab !== 'accounts'"
             class="tab-panel">
      <LoadingMessage v-if="state.isLoading" :description="t('loading')" />
      <div v-else-if="accounts && accounts.length > 0">
        <h3>{{ t('accounts_title') }}</h3>
        <table role="table" aria-label="User accounts">
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
      <EmptyLayout v-else :title="t('noAccounts')" :description="t('noAccountsDescription')">
        <button type="button" class="primary" @click="activateTab('invitations')">
          {{ t('inviteNewAccount') }}
        </button>
      </EmptyLayout>
    </section>
    <section
      id="applications-panel"
      role="tabpanel"
      aria-labelledby="applications-tab"
      :aria-hidden="state.activeTab == 'applications' ? 'false' : 'true'"
      :hidden="state.activeTab !== 'applications'"
      class="tab-panel">
      <ApplicationsView />
    </section>
    <section
      id="invitations-panel"
      role="tabpanel"
      aria-labelledby="invitations-tab"
      :aria-hidden="state.activeTab == 'invitations' ? 'false' : 'true'"
      :hidden="state.activeTab !== 'invitations'"
      class="tab-panel">
      <InvitationsView />
    </section>
  </section>
</template>
