<style scoped lang="scss">
@use '../../assets/mixins' as *;
section {
    border-top: 1px soilid $light-mode-border;
    padding: 10px;
    margin-top: 10px;
    label {
        display: block;
        margin-bottom: 10px;
    }
    input {
        -webkit-appearance: none;
        -moz-appearance: none;
        appearance: none;
        font-size: 14px;
        display: block;
        margin: 6px 0;
        border-radius: 6px;
        border: 1px solid $light-mode-border;
        padding: 6px;
        @include dark-mode {
            color: $dark-mode-input-text;
            background: $dark-mode-input-background;
            border-color: $dark-mode-border;
        }
    }
    div.schedule {
        margin-bottom: 15px;
    }
    @include dark-mode {
        border-top: 1px solid $dark-mode-border;
    }
}
section.location, section.description {
    input[type="text"] {
        width: 100%;
    }
}
section.location {
    input[type="text"] {
        max-width: 500px;
    }
}
button {
    font-size: 14px;
    border: 1px solid $light-mode-border;
    border-radius: 6px;
    padding: 6px 10px;
    margin-right: 10px;
    @include dark-mode {
        color: $dark-mode-text;
        background: $dark-mode-background;
        border-color: $dark-mode-border;
    }
    &.remove {
        font-size: 20px;
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
    <modal-layout :title="props.event.id ? t('edit_event_title') : t('create_event_title')" @close="$emit('close')">
    <div class="event">
        <div class="error" v-if="state.err">{{ state.err }}</div>
        <section class="description">
            <label>Event Description</label>
            <select v-model="state.lang">
                <option v-for="lang in languages" :value="lang">{{  iso6391.getName(lang) }}</option>
            </select>
            <button :aria-label="t('add_language')" @click="state.showLanguagePicker=true;">➕</button>
            <div v-for="language in languages" >
                <div v-if="language == state.lang" :dir="iso6391.getDir(language) == 'rtl' ? 'rtl' : ''">
                    <input type="text" name="name" v-bind:placeholder="t('name_placeholder')"    v-model="props.event.content(language).name">
                    <input type="text" name="description" v-bind:placeholder="t('description_placeholder')" v-model="props.event.content(language).description">
                    <button @click="removeLanguage(language)">{{ t('remove_language') }}</button>
                </div>
            </div>
        </section>
        <section class="location">
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
                <button class="remove" v-if="props.event.schedules.length > 1" type="button" @click="props.event.dropSchedule(index)">&times;</button>
                <event-recurrence-view :schedule="schedule" />
            </div>
            <button type="button" @click="props.event.addSchedule()">{{ t("add_date_button") }}</button>
        </section>
        <section>
          <button type="submit" @click="saveModel(props.event)">{{ props.event.id ? t("update_button") : t("create_button") }}</button>
          <button type="button" @click="$emit('close')">Close</button>
        </section>
    </div>
    </modal-layout>
    <div v-if="state.showLanguagePicker">
        <language-picker :languages="availableLanguages" :selectedLanguages="languages"  @close="state.showLanguagePicker = false" @select="(lang) => addLanguage(lang)"/>
    </div>
</template>

<script setup>
    import { reactive, ref } from 'vue';
    import { useTranslation } from 'i18next-vue';
    import { CalendarEvent } from '../../../common/model/events';
    import ModelService from '../../service/models';
    import { useEventStore } from '../../stores/eventStore';
    import EventRecurrenceView from './event_recurrence.vue';
    import languagePicker from '../languagePicker.vue';
    import ModalLayout from '../modal.vue';
    import iso6391 from 'iso-639-1-dir';

    const eventStore = useEventStore();

    const { t } = useTranslation('event_editor', {
        keyPrefix: 'editor'
    });
    const props = defineProps({
        event: CalendarEvent
    });

    let defaultLanguage = 'en';
    let l = props.event.getLanguages();
    l.unshift(defaultLanguage);
    const languages = ref([...new Set(l)]);

    let allLanguages = iso6391.getAllCodes();
    allLanguages.unshift(defaultLanguage);
    let availableLanguages = ref([...new Set(allLanguages)]);

    const state = reactive({
        err: '',
        showLanguagePicker: false,
        lang: defaultLanguage,
    });

    const addLanguage = (language) => {
        languages.value = [...new Set(languages.value.concat(language))];
        state.lang = language;
    }

    const removeLanguage = (language) => {
        props.event.dropContent(language);
        languages.value = languages.value.filter(l => l != language);
        state.lang = languages.value[0];
    }

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
