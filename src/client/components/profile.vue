<script setup>
import { reactive, inject } from 'vue';
import { useI18n } from 'vue-i18n';

const authn = inject('authn');

const state = reactive({
    userInfo: {
        isAdmin: authn.isAdmin(),
        currentEvent: null
    }
});

const { t } = useI18n({
        messages: {
            "en": {
                "admin_link": "Admin"
            },
            "es": {
                "admin_link": "Admin"
            }
        }
    });

</script>

<template>
  <p>profile</p>
  <ul>
    <li>email: {{ email }}</li>
    <li><a href="/follow-list">Following {{ following_count }}</a></li>
    <li><a href="/password">Update Password</a></li>
    <li><router-link v-if="state.userInfo.isAdmin" to="/admin" class="button">{{ t("admin_link") }}</router-link></li>
    <router-link :to="{ name: 'logout' }">Logout</router-link>
  </ul>
</template>

<style scoped lang="scss">
</style>