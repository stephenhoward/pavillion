<style scoped lang="scss">
.language-picker-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 0;
}

.search-section {
  .search-input-wrapper {
    position: relative;

    .search-icon {
      position: absolute;
      left: 1rem;
      top: 50%;
      transform: translateY(-50%);
      width: 1.25rem;
      height: 1.25rem;
      color: var(--pav-color-stone-400);
      pointer-events: none;
    }

    input {
      width: 100%;
      padding: 0.75rem 1rem 0.75rem 3rem;
      border-radius: 9999px; // rounded-full
      background: var(--pav-color-stone-100);
      border: none;
      color: var(--pav-color-stone-900);
      font-size: 1rem;
      transition: all 0.15s ease;

      &::placeholder {
        color: var(--pav-color-stone-400);
      }

      &:focus {
        outline: none;
        box-shadow: 0 0 0 2px var(--pav-color-orange-500);
      }

      @media (prefers-color-scheme: dark) {
        background: var(--pav-color-stone-800);
        color: var(--pav-color-stone-100);
      }
    }
  }
}

.language-list {
  flex: 1;
  overflow-y: auto;
  min-height: 0;

  .empty-state {
    text-align: center;
    padding: 2rem;
    color: var(--pav-color-stone-500);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }

  ul {
    list-style-type: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;

    li {
      button {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem 1rem;
        border-radius: 0.75rem; // rounded-xl
        text-align: start;
        background: transparent;
        border: none;
        cursor: pointer;
        transition: background 0.15s ease;
        color: var(--pav-color-stone-900);

        &:hover {
          background: var(--pav-color-stone-100);

          @media (prefers-color-scheme: dark) {
            background: var(--pav-color-stone-800);
          }
        }

        @media (prefers-color-scheme: dark) {
          color: var(--pav-color-stone-100);
        }

        .native-name {
          font-weight: 500;
        }

        .english-name {
          font-size: 0.875rem;
          color: var(--pav-color-stone-500);

          @media (prefers-color-scheme: dark) {
            color: var(--pav-color-stone-400);
          }
        }
      }
    }
  }
}
</style>

<template>
  <Sheet :title="t('select_language')" @close="closeModal">
    <div
      class="language-picker-body"
      :dir="iso6391.getDir(DEFAULT_LANGUAGE_CODE) == 'rtl' ? 'rtl' : ''"
    >
      <!-- Search -->
      <div class="search-section">
        <div class="search-input-wrapper">
          <svg
            class="search-icon"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
          <input
            type="search"
            :placeholder="t('search_language')"
            v-model="state.searchString"
            @input="filterLanguages()"
            @search="filterLanguages()"
            autofocus
          />
        </div>
      </div>

      <!-- Language List -->
      <div class="language-list">
        <div v-if="state.filteredLanguages.length === 0" class="empty-state">
          {{ availableLanguages.length === 0 ? t('all_languages_added') : t('no_languages_match') }}
        </div>
        <ul v-else>
          <li v-for="lang in state.filteredLanguages" :key="lang">
            <button type="button" @click="selectLanguage(lang)">
              <span class="native-name" :dir="iso6391.getDir(lang) == 'rtl' ? 'rtl' : ''">
                {{ iso6391.getNativeName(lang) }}
              </span>
              <span v-if="iso6391.getName(lang) !== iso6391.getNativeName(lang)" class="english-name">
                {{ iso6391.getName(lang) }}
              </span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </Sheet>
</template>

<script setup>
import { reactive, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import iso6391 from 'iso-639-1-dir';
import { DEFAULT_LANGUAGE_CODE } from '@/common/i18n/languages';
import Sheet from '@/client/components/common/Sheet.vue';

const emit = defineEmits(['close', 'select']);

const { t } = useTranslation('system', {
  keyPrefix: 'language_picker',
});

const props = defineProps({
  languages: Array,
  selectedLanguages: Array,
});

const state = reactive({
  searchString: '',
  filteredLanguages: props.languages,
});

// Compute available languages (excluding already selected ones)
const availableLanguages = computed(() => {
  return props.languages.filter(lang =>
    !props.selectedLanguages || !props.selectedLanguages.includes(lang),
  );
});

const filterLanguages = () => {
  const languagesToFilter = availableLanguages.value;

  if (state.searchString.length === 0) {
    state.filteredLanguages = languagesToFilter;
    return;
  }

  state.filteredLanguages = languagesToFilter.filter(lang => {
    return iso6391.getNativeName(lang).toLowerCase().includes(state.searchString.toLowerCase())
            ||  iso6391.getName(lang).toLowerCase().includes(state.searchString.toLowerCase())
            ||  lang.toLowerCase().includes(state.searchString.toLowerCase());
  });
};

const selectLanguage = (lang) => {
  emit('select', lang);
  emit('close');
};

const closeModal = () => {
  emit('close');
};

// Initialize filtered languages on mount
state.filteredLanguages = availableLanguages.value;
</script>
