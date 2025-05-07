<script setup>
import { reactive, nextTick } from 'vue';
import { useTranslation } from 'i18next-vue';
import InvitationsView from './accounts/invitations.vue';
import ApplicationsView from './accounts/applications.vue';

const { t } = useTranslation('admin', {
  keyPrefix: 'accounts',
});

const state = reactive({
  activeTab: 'accounts',
});

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
        :class="{ 'active-tab': state.activeTab === index }"
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
        :class="{ 'active-tab': state.activeTab === index }"
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
      <h3>{{ t('accounts_title') }}</h3>
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

  div[role="tablist"] {
    margin-bottom: 20px;
    display: flex;
    border-bottom: 1px solid $light-mode-border;
    button[role="tab"] {
      border-radius: 0;
      font-size: 10pt;
      background:none;
      border: none;
      color: $light-mode-text;
      flex: 1;
      max-width: 150px;
      padding: 10px 20px;
      cursor: pointer;
      margin-right: 15px;
      &[aria-selected="true"] {
        border-bottom: 4px solid $light-mode-button-background;
      }
    }
  }
}

@include dark-mode {
  #accounts {
  div[role="tablist"] {
    border-bottom-color: $dark-mode-border;
    button[role="tab"] {
      color: $dark-mode-text;
      &[aria-selected="true"] {
        border-bottom-color: $dark-mode-button-background;
        ;
      }
    }
  }
}
}

</style>
