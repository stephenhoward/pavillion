<style scoped lang="scss">
@use '../assets/mixins' as *;
ul {
    list-style-type: none;
    padding: 0;
    margin: 0;
    li {
        padding: 10px;
        border-bottom: 1px solid $light-mode-border;
        &:last-child {
            border-bottom: none;
        }
        display: flex;
        flex-direction: row;

        span {
            display: block;
            &:first-child {
              flex: 1;
            }
        }
        &.selected {
            background: $light-mode-selected-background;
            @include dark-mode {
                background: $dark-mode-selected-background;
            }
        }
    }
}
input[type="search"] {
    width: 100%;
    padding: 10px;
    margin: 10px 0;
    border-radius: 6px;
    border: 1px solid $light-mode-border;
    @include dark-mode {
        color: $dark-mode-input-text;
        background: $dark-mode-input-background;
        border-color: $dark-mode-border;
    }
}
</style>

<template>
  <ModalLayout :title="t('select_language')">
    <div class="languages" :dir="iso6391.getDir(defaultLanguage) == 'rtl' ? 'rtl' : ''">
      <input type="search"
             :placeholder="t('search_language')"
             v-model="state.searchString"
             @keyup="filterLanguages()"
             @search="filterLanguages()" />
      <ul>
        <li :class="selectedLanguages.indexOf(lang) >= 0 ? 'selected' : ''" v-for="lang in state.filteredLanguages" @click="selectLanguage(lang)">
          <span class="native-name" :dir="iso6391.getDir(lang) == 'rtl' ? 'rtl' : ''" >{{  iso6391.getNativeName(lang) }}</span>
          <span v-if="iso6391.getName(lang) != iso6391.getNativeName(lang)">({{ iso6391.getName(lang) }})</span>
        </li>
      </ul>
    </div>
  </ModalLayout>
</template>

<script setup>
import { reactive } from 'vue';
import { useTranslation } from 'i18next-vue';
import ModalLayout from './modal.vue';
import iso6391 from 'iso-639-1-dir';
const emit = defineEmits(['close', 'select']);

const { t } = useTranslation('system', {
  keyPrefix: 'language_picker',
});

const defaultLanguage = 'en';

const props = defineProps({
  languages: Array,
  selectedLanguages: Array,
});

const state = reactive({
  searchString: '',
  filteredLanguages: props.languages,
});

const filterLanguages = () => {
  if (state.searchString.length == 0 ) {
    state.filteredLanguages = props.languages;
    return;
  }
  state.filteredLanguages = props.languages.filter(lang => {
    return iso6391.getNativeName(lang).toLowerCase().includes(state.searchString.toLowerCase())
            ||  iso6391.getName(lang).toLowerCase().includes(state.searchString.toLowerCase());
  });
};
const selectLanguage = (lang) => {
  console.log(lang);
  emit('select', lang);
  emit('close');
};
</script>
