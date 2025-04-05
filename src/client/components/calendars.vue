<script setup>
import { onBeforeMount, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Calendar } from '../../common/model/calendar';
import ModelService from '../service/models';

const { t } = useI18n({
    messages: {
        en: {
            'create_button': 'Create Event',
            'update_button': 'Update Event',
            name_placeholder: 'event name',
            description_placeholder: 'event description',
        }

    }
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
  <p>Calendars</p>
    <section v-if="state.calendars.length > 0">
        <ul v-for="calendar in state.calendars">
            <RouterLink to="/calendar" prop="calendar">
            <li>{{ calendar.content("en").name || calendar.urlName }}</li>
            </RouterLink>
        </ul>
    </section>
    <section v-else>
        <p>No calendars found</p>
    </section>
</template>

<style scoped lang="scss">
</style>