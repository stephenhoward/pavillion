<style scoped lang="scss">
ul {
    list-style-type: none;
    padding: 0;
    margin: 0;
    li {
        padding: var(--pav-space-3);
        border-bottom: 1px solid var(--pav-color-border);
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
            background: var(--pav-color-surface-selected);
        }
    }
}
input[type="search"] {
    width: 100%;
    padding: var(--pav-space-3);
    margin: var(--pav-space-3) 0;
    border-radius: var(--pav-border-radius);
    border: 1px solid var(--pav-color-border);
    color: var(--pav-color-text-primary);
    background: var(--pav-color-surface-primary);
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
import ModalLayout from '@/client/components/common/modal.vue';
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
  emit('select', lang);
  emit('close');
};
</script>
