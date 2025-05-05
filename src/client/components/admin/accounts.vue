<script setup>
  import { useTranslation } from 'i18next-vue';
  import InvitationsView from './accounts/invitations.vue';

  const { t } = useTranslation('admin', {
    keyPrefix: 'accounts',
  });

</script>

<template>
    <div>
      <h3>{{ t('account_applications') }}</h3>
      <invitations-view />
    <h3>{{ t('accounts_title') }}</h3>
    </div>
</template>
