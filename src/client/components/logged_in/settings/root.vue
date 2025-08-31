<script setup>
import { reactive, inject } from 'vue';
import { useTranslation } from 'i18next-vue';
import EmailForm from '@/client/components/logged_in/settings/email_modal.vue';
import PasswordForm from '@/client/components/logged_in/settings/password_modal.vue';

const authn = inject('authn');

const state = reactive({
  userInfo: {
    isAdmin: authn.isAdmin(),
    email: authn.userEmail(),
  },
  changeEmail: false,
  changePassword: false,
});

const { t } = useTranslation('profile');

</script>

<template>
  <div class="settings">
    <header>
      <h2>{{ t("title") }}</h2>
    </header>
    <form class="settings-form">
      <div class="form-group">
        <label id="language-preference-label" class="form-label">{{ t("language_preference_label") }}</label>
        <div class="form-field" aria-labelledby="language-preference-label">
          <select/>
        </div>
      </div>
      <div class="form-group">
        <label id="email-label" class="form-label">{{ t("account_email_label") }}</label>
        <div class="form-field" aria-lablledby="email-label">
          {{ state.userInfo.email }}
          <button type="button" @click="state.changeEmail=true">{{ t("change_email_button") }}</button>
        </div>
      </div>
      <div class="form-group">
        <label id="password-label" class="form-label">{{ t("account_password_label") }}</label>
        <div class="form-field" aria-lablledby="email-label">
          <button type="button" @click="state.changePassword=true">{{ t("change_password_button") }}</button>
        </div>
      </div>
      <div v-if="state.userInfo.isAdmin" class="form_group">
        <router-link class="admin-link" to="/admin/settings">{{ t("admin_link") }}</router-link>
      </div>
      <router-link class="button" :to="{ name: 'logout' }">{{ t("logout") }}</router-link>

    </form>
    <div v-if="state.changeEmail">
      <EmailForm @close="(email) => { if(email) state.userInfo.email = email; state.changeEmail=false; }" />
    </div>
    <div v-if="state.changePassword">
      <PasswordForm @close="state.changePassword=false" />
    </div>
  </div>
</template>
