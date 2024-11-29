<template>
    <div class="event">
        <div class="error" v-if="state.err">{{ state.err }}</div>
        <input type="text" v-bind:placeholder="t('name_placeholder')"    v-model="props.event.content('en').name">
        <input type="text" v-bind:placeholder="t('description_placeholder')" v-model="props.event.content('en').description">
        <button type="submit" @click="saveModel(props.event)">{{ props.event.id ? t("update_button") : t("create_button") }}</button>
    </div>
</template>

<script setup>
    import { reactive, defineProps } from 'vue';
    import { useI18n } from 'vue-i18n';
    import { CalendarEvent } from '../../common/model/events';
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

    const props = defineProps({
        event: CalendarEvent
    });

    const state = reactive({ err: ''});

    const saveModel = async (model) => {
        props.event = model.id
            ? CalendarEvent.fromObject(await ModelService.updateModel(model, '/api/v1/events'))
            : CalendarEvent.fromObject(await ModelService.createModel(model, '/api/v1/events'));
    };
</script>

<style scoped lang="scss">
@import '../assets/mixins.scss';

body {
    display:               grid;

    grid-template-columns: [ begin ] auto [ end ];
    grid-template-rows:    [ top ] auto [ bottom ];
    justify-items: center;
    align-items: center;
    div.event {
        @include auth-form;
    }
}
</style>