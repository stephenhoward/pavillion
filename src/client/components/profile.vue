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
  <div class="settings-section">
    <header>
      <h2>{{ t("title") }}</h2>
      <router-link class="button" :to="{ name: 'logout' }">{{ t("logout") }}</router-link>
    </header>
    <form class="settings-form">
      <div class="form-group">
        <label id="language-preference-label" class="form-label">{{ t("language_preference_label") }}</label>
        <div class="form-field" aria-labelledby="language-preference-label">
          <select></select>
        </div>
      </div>
      <div class="form-group">
        <label id="email-label" class="form-label">{{ t("account_email_label") }}</label>
        <div class="form-field" aria-lablledby="email-label">
          {{ email }}
          <button type="button">{{ t("change_email_button") }}</button>
        </div>
      </div>
      <div class="form-group">
        <label id="password-label" class="form-label">{{ t("account_password_label") }}</label>
        <div class="form-field" aria-lablledby="email-label">
          <button type="button">{{ t("change_password_button") }}</button>
        </div>
      </div>
      <div v-if="state.userInfo.isAdmin" class="form_group">
        <router-link class="admin-link" to="/admin/settings">{{ t("admin_link") }}</router-link>
      </div>
    </form>
  </div>
</template>

<style scoped lang="scss">
@use '../assets/mixins' as *;

header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  a {
    display: block;
    flex: 0;
  }
}
.settings-section {
  margin: 10px;
}
h2 {
  font-weight: 300;
}
a.admin-link {
  color: $light-mode-text;
  @include dark-mode {
    color: $dark-mode-text;
  }
}
</style>
