<script setup>
import { onBeforeMount, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { Calendar } from '../../../common/model/calendar';
import ModelService from '../../service/models';

const { t } = useTranslation('calendars', {
  keyPrefix: 'list',
});

const router = useRouter();
const state = reactive({ err: '', calendars: []});

onBeforeMount(async () => {
  let calendars = await ModelService.listModels('/api/v1/calendars');
  if ( calendars.length == 1 ) {
    // If there is only one calendar, redirect to it
    let calendar = calendars[0];
    this.$router.push({ path: '/calendar/' + calendar.urlName });
  }
  else {
    state.calendars = calendars.map(calendar => Calendar.fromObject(calendar));
  }
});
</script>

<template>
  <div v-if="state.calendars.length > 0">
    <p>{{ t('my_calendars_header') }}</p>
    <ul v-for="calendar in state.calendars">
      <RouterLink to="/calendar" prop="calendar">
        <li>{{ calendar.content("en").name || calendar.urlName }}</li>
      </RouterLink>
    </ul>
  </div>
  <div v-else class="empty-screen">
    <h2>{{ t('no_calendars_message') }}</h2>
    <button type="button" class="primary" @click="$emit('openEvent', new Calendar())">
      {{ t('create_calendar_button') }}
    </button>
  </div>
</template>

<style lang="scss">
@use '../../assets/layout.scss' as *;

</style>
