<script setup>
import { reactive, inject } from 'vue';
import { useTranslation } from 'i18next-vue';

const authn = inject('authn');

const state = reactive({
    userInfo: {
        isAdmin: authn.isAdmin(),
        currentEvent: null
    }
});

const { t } = useTranslation('profile');

</script>

<template>
  <p>profile</p>
  <ul>
    <li>email: {{ email }}</li>
    <li><a href="/password">Update Password</a></li>
    <li><router-link v-if="state.userInfo.isAdmin" to="/admin" class="button">{{ t("admin_link") }}</router-link></li>
    <router-link :to="{ name: 'logout' }">Logout</router-link>
  </ul>
</template>

<style scoped lang="scss">
</style>