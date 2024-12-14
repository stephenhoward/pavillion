<style scoped lang="scss">
@use '../assets/mixins' as *;
section {
    border-top: 1px soilid $light-mode-border;
    padding: 10px;
    margin-top: 10px;
    label {
        display: block;
    }
    input {
        font-size: 14px;
        &[type="datetime-local"] {
            font-size: 14px;
        }
    }
    @include dark-mode {
        border-top: 1px solid $dark-mode-border;
    }
}
button {
    &.remove {
        background: none;
        border: none;
        display: block;
        float: right;
    }
    img {
        width: 16px;
    }
}

div.schedule {
    width: 100%;
}
</style>

<template>
    <modal-layout :title="props.event.id ? t('edit_event_title') : t('create_event_title')">
    <div class="event">
        <div class="error" v-if="state.err">{{ state.err }}</div>
        <section>
            <label>Event Description</label>
            <input type="text" name="name" v-bind:placeholder="t('name_placeholder')"    v-model="props.event.content('en').name">
            <input type="text" name="description" v-bind:placeholder="t('description_placeholder')" v-model="props.event.content('en').description">
        </section>
        <section>
            <label>Location</label>
            <input type="text" name="name" v-bind:placeholder="t('location_name_placeholder')" v-model="props.event.location.name">
            <input type="text" name="address" v-bind:placeholder="t('address_placeholder')" v-model="props.event.location.address">
            <input type="text" name="city" v-bind:placeholder="t('city_placeholder')" v-model="props.event.location.city">
            <input type="text" name="state" v-bind:placeholder="t('state_placeholder')" v-model="props.event.location.state">
            <input type="text" name="postalCode" v-bind:placeholder="t('postalCode_placeholder')" v-model="props.event.location.postalCode">
        </section>
        <section>
            <label>Dates</label>
            <div class="schedule" v-for="(schedule,index) in props.event.schedules">
                <button class="remove" v-if="props.event.schedules.length > 1" type="button" @click="props.event.dropSchedule(index)"><img src="../assets/remove_icon.svg" alt="Remove Schedule"/></button>
                <event-recurrence-view :schedule="schedule" />
            </div>
        <button type="button" @click="props.event.addSchedule()">Add Schedule</button>
        </section>
        <section>
          <button type="submit" @click="saveModel(props.event)">{{ props.event.id ? t("update_button") : t("create_button") }}</button>
          <button type="button" @click="$emit('close')">Close</button>
        </section>
    </div>
    </modal-layout>
</template>

<script setup>
    import { reactive } from 'vue';
    import { useI18n } from 'vue-i18n';
    import { CalendarEvent } from '../../common/model/events';
    import ModelService from '../service/models';
    import { useEventStore } from '../stores/eventStore';
    import EventRecurrenceView from './event_recurrence.vue';
    import ModalLayout from './modal.vue';

    const eventStore = useEventStore();

    const { t } = useI18n({
        messages: {
            en: {
                'edit_event_title': 'Edit Event',
                'create_event_title': 'Create Event',
                'create_button': 'Create Event',
                'update_button': 'Update Event',
                'close_button': 'Close',
                name_placeholder: 'event name',
                description_placeholder: 'event description',
                location_name_placeholder: 'name',
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
