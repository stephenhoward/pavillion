<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import Config from '@/client/service/config';
import FundingSheet from '@/client/components/logged_in/calendar-management/funding-sheet.vue';
import { useFundingAccess } from '@/client/composables/useFundingAccess';
import type { FundingGatedFeature } from '@/common/model/funding-plan';

/**
 * The shared upsell for a funding-gated feature.
 *
 * One component so that no feature has to re-derive "should we be selling
 * anything here". It answers that itself from `useFundingAccess`, renders
 * nothing unless the gate is *known* to be closed, and opens the existing
 * FundingSheet when the reader acts on it. A consumer's whole obligation is to
 * place it and name a feature.
 *
 * The self-gating is the point. `useFundingAccess` distinguishes `granted`,
 * `denied` and `unknown`, and only `denied` is a reason to offer funding —
 * `unknown` means we could not read the funding state, and an operator whose
 * database hiccuped must not be told their community owes money. Leaving that
 * branch to each consumer invites `v-if="!hasAccess(...)"`, which reads as the
 * obvious spelling and is exactly the bug. Here it is written once.
 *
 * A `feature` key that is not in the registry lands in the same place: nothing
 * is cached under it, so the state is `unknown` and the card stays silent
 * rather than guessing.
 */
const props = defineProps<{
  /** The calendar whose funding gate is being read. */
  calendarId: string;
  /** The gated feature this upsell is about. */
  feature: FundingGatedFeature;
}>();

const emit = defineEmits<{
  /**
   * A funding plan was started from this card, and the calendar's access has
   * already been re-read. Consumers use it to report success or retry the
   * action the gate refused.
   */
  'plan-started': [];
}>();

const { t } = useTranslation('funding', { keyPrefix: 'upsell' });

const { isDenied, ensureLoaded, refresh } = useFundingAccess(props.calendarId);

const instanceName = ref('');
const showFundingSheet = ref(false);

const showUpsell = computed(() => isDenied(props.feature));

/**
 * The feature-specific pitch, one key per registry entry.
 *
 * Written out rather than derived as `` t(`${feature}_message`) ``. The
 * template literal reads as less ceremony and hides a real coupling: adding a
 * feature to `FUNDING_GATED_FEATURES` and forgetting its copy would ship an
 * upsell whose message is the raw key. Keyed on `FundingGatedFeature`, the
 * same omission is a type error at the registry entry.
 */
const FEATURE_MESSAGE_KEYS: Record<FundingGatedFeature, string> = {
  widget_embedding: 'widget_embedding_message',
};

const message = computed(() => {
  // Only reachable for a registered feature — the card is hidden for anything
  // else, because nothing is ever cached under an unregistered key. The
  // fallback keeps a mistyped prop from throwing on the way to rendering
  // nothing.
  const feature: FundingGatedFeature = props.feature;
  const key: string | undefined = FEATURE_MESSAGE_KEYS[feature];
  return key ? t(key, { instanceName: instanceName.value }) : '';
});

onMounted(async () => {
  // Cheap when another consumer already asked: the composable serves a cached
  // summary without a request and joins a load already in flight.
  await ensureLoaded();

  const config = await Config.init();
  instanceName.value = config.settings().siteTitle || t('this_instance');
});

/**
 * Fold a completed checkout back into the shared cache before telling the
 * consumer. Refreshing first means the gate answer the consumer reads in its
 * own handler is the post-payment one, and this card has already hidden itself
 * by the time anything else runs.
 */
async function onPlanStarted() {
  showFundingSheet.value = false;
  await refresh();
  emit('plan-started');
}
</script>

<template>
  <div v-if="showUpsell" class="alert alert--info funding-upsell" role="status">
    <p class="funding-upsell__message">{{ message }}</p>
    <!--
      A closed gate is the weaker claim "nothing we can see grants this": the
      server contributes a denial for a funding source it could not read as
      well as for one that answered no. The hint keeps the copy honest about
      that without turning the common case into a wall of caveats.
    -->
    <p class="funding-upsell__hint">{{ t('already_contributing') }}</p>
    <button
      type="button"
      class="btn btn--primary btn--sm funding-upsell__action"
      @click="showFundingSheet = true"
    >
      {{ t('action') }}
    </button>
  </div>

  <FundingSheet
    v-if="showFundingSheet"
    :calendarId="props.calendarId"
    :instanceName="instanceName"
    @close="showFundingSheet = false"
    @plan-started="onPlanStarted"
  />
</template>
