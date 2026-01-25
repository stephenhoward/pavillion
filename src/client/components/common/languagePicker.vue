<style scoped lang="scss">
.language-selector-modal {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;

  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    cursor: pointer;
  }

  .modal-content {
    position: relative;
    width: 100%;
    max-width: 28rem; // 448px
    background: white;
    border-radius: 1rem; // rounded-2xl
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    max-height: 80vh;
    display: flex;
    flex-direction: column;

    @media (prefers-color-scheme: dark) {
      background: var(--pav-color-stone-900);
    }
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.5rem;
    border-bottom: 1px solid var(--pav-color-stone-200);

    @media (prefers-color-scheme: dark) {
      border-bottom-color: var(--pav-color-stone-700);
    }

    h2 {
      font-size: 1.25rem; // text-xl
      font-weight: 300; // font-light
      color: var(--pav-color-stone-900);
      margin: 0;

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-stone-100);
      }
    }

    .close-button {
      padding: 0.5rem;
      color: var(--pav-color-stone-400);
      background: transparent;
      border: none;
      border-radius: 0.5rem;
      cursor: pointer;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      justify-content: center;

      &:hover {
        color: var(--pav-color-stone-600);
        background: var(--pav-color-stone-100);

        @media (prefers-color-scheme: dark) {
          color: var(--pav-color-stone-300);
          background: var(--pav-color-stone-800);
        }
      }
    }
  }

  .search-section {
    padding: 1rem;
    border-bottom: 1px solid var(--pav-color-stone-200);

    @media (prefers-color-scheme: dark) {
      border-bottom-color: var(--pav-color-stone-700);
    }

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
    padding: 0.5rem;

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
}
</style>

<template>
  <div class="language-selector-modal">
    <!-- Backdrop -->
    <div class="backdrop" @click="closeModal" />

    <!-- Modal -->
    <div class="modal-content" :dir="iso6391.getDir(defaultLanguage) == 'rtl' ? 'rtl' : ''">
      <!-- Header -->
      <div class="modal-header">
        <h2>{{ t('select_language') }}</h2>
        <button
          type="button"
          class="close-button"
          @click="closeModal"
          :aria-label="t('close')"
        >
          <svg
            width="20"
            height="20"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

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
  </div>
</template>

<script setup>
import { reactive, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
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
