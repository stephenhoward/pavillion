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
  <div class="root logged-in">
    <a href="#main" class="sr-only">{{ t("navigation.skip_to_content") }}</a>
    <nav>
      <li><router-link to="/profile">{{ t("back") }}</router-link></li>
      <li :class="{ selected: isActive('/admin/settings') }">
        <router-link :to="{ name: 'admin_settings'}"
                     :aria-current="isActive('/admin/settings') ? 'page' : undefined">
          {{ t("general_settings") }}
        </router-link>
      </li>
      <li :class="{ selected: isActive('/admin/accounts'), badged: false }">
        <router-link :to="{ name: 'accounts' }"
                     :aria-current="isActive('/admin/accounts') ? 'page' : undefined">
          {{ t("accounts_link") }}
        </router-link>
      </li>
      <li :class="{ selected: isActive('/admin/federation') }">
        <router-link :to="{ name: 'federation' }"
                     :aria-current="isActive('/admin/federation') ? 'page' : undefined">
          {{ t("federation_settings") }}
        </router-link>
      </li>
      <li :class="{ selected: isActive('/admin/funding') }">
        <router-link :to="{ name: 'funding' }"
                     :aria-current="isActive('/admin/funding') ? 'page' : undefined">
          {{ t("payment_details") }}
        </router-link>
      </li>
    </nav>
    <main id="main">
      <RouterView />
    </main>
  </div>
</template>

