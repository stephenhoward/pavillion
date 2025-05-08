<script setup>
import { reactive, inject } from 'vue';
import { useTranslation } from 'i18next-vue';

const authn = inject('authn');

const state = reactive({
  userInfo: {
    isAdmin: authn.isAdmin(),
    currentEvent: null,
  },
});

const { t } = useTranslation('profile');

</script>

<template>
  <div>
    <h2>{{ t("title") }}</h2>
    <ul>
      <li>{{ t("email_label") }}: {{ email }}</li>
      <li><a href="/password">{{ t("update_password") }}</a></li>
      <li><router-link v-if="state.userInfo.isAdmin" to="/admin/settings">{{ t("admin_link") }}</router-link></li>
      <router-link :to="{ name: 'logout' }">{{ t("logout") }}</router-link>
    </ul>
  </div>
</template>

<style scoped lang="scss">
h2 {
  font-weight: 300;
}
</style>
