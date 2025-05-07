<script setup>
import { inject } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute } from 'vue-router';

const route = useRoute();

const site_config = inject('site_config');
const { t } = useTranslation('admin', {
  keyPrefix: 'menu',
});

const isActive = (path) => {
  return route.path === path;
};
</script>

<template>
  <div class="root">
    <nav>
      <li><router-link to="/profile">{{ t("back") }}</router-link></li>
      <li :class="{ selected: isActive('/admin/settings') }"><router-link :to="{ name: 'admin_settings'}">{{  t("general_settings") }}</router-link></li>
      <li :class="{ selected: isActive('/admin/accounts'), badged: false }"><router-link :to="{ name: 'accounts' }">{{ t("accounts_link") }}</router-link></li>
      <li :class="{ selected: isActive('/admin/federation') }"><router-link :to="{ name: 'federation' }">{{ t("federation_settings") }}</router-link></li>
      <li :class="{ selected: isActive('/admin/funding') }"><router-link :to="{ name: 'funding' }">{{ t("payment_details") }}</router-link></li>
    </nav>
    <div id="main">
      <RouterView />
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../assets/layout.scss' as *;

</style>
