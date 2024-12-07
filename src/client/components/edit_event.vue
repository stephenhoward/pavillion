<template>
    <div class="event">
        <div class="error" v-if="state.err">{{ state.err }}</div>
        <input type="text" name="name" v-bind:placeholder="t('name_placeholder')"    v-model="props.event.content('en').name">
        <input type="text" name="description" v-bind:placeholder="t('description_placeholder')" v-model="props.event.content('en').description">
        <input type="text" name="address" v-bind:placeholder="t('address_placeholder')" v-model="props.event.location.address">
        <input type="text" name="city" v-bind:placeholder="t('city_placeholder')" v-model="props.event.location.city">
        <input type="text" name="state" v-bind:placeholder="t('state_placeholder')" v-model="props.event.location.state">
        <input type="text" name="postalCode" v-bind:placeholder="t('postalCode_placeholder')" v-model="props.event.location.postalCode">
        <button type="submit" @click="saveModel(props.event)">{{ props.event.id ? t("update_button") : t("create_button") }}</button>
    </div>
</template>

<script setup>
    import { reactive, defineProps, onBeforeMount } from 'vue';
    import { useI18n } from 'vue-i18n';
    import { CalendarEvent } from '../../common/model/events';
    import { EventLocation } from '../../common/model/location';
    import ModelService from '../service/models';
    import { useEventStore } from '../stores/eventStore';

    const eventStore = useEventStore();

    const { t } = useI18n({
        messages: {
            en: {
                'create_button': 'Create Event',
                'update_button': 'Update Event',
                name_placeholder: 'event name',
                description_placeholder: 'event description',
                address_placeholder: 'event address',
                city_placeholder: 'city',
                state_placeholder: 'state',
                postalCode_placeholder: 'zip code'
            }

        }
    });

    const props = defineProps({
        event: CalendarEvent
    });

    const state = reactive({ err: '' });

    const saveModel = async (model) => {
        const isNew = !model.id;
        state.event = isNew
            ? CalendarEvent.fromObject(await ModelService.createModel(model, '/api/v1/events'))
            : CalendarEvent.fromObject(await ModelService.updateModel(model, '/api/v1/events'));

        if ( isNew == true ) {
            eventStore.addEvent(props.event.clone());
        }
        else {
            eventStore.updateEvent(props.event.clone());
        }
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