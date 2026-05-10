import { describe, it, expect, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { mountComponent } from '@/client/test/lib/vue';
import SpacesEditor from '@/client/components/logged_in/calendar/SpacesEditor.vue';
import {
  EventLocationSpace,
  EventLocationSpaceContent,
} from '@/common/model/location';

/**
 * Build an `EventLocationSpace` populated with translated content for the
 * supplied languages. Identity is keyed off the `id` argument: rows with an
 * empty `id` represent staged-but-unsaved Spaces and exercise the (new)
 * affordance branch.
 */
const createMockSpace = (
  id: string,
  placeId: string,
  contents: Array<{ language: string; name: string; accessibilityInfo?: string }> = [],
  eventCount?: number,
) => {
  const space = new EventLocationSpace(id, placeId);
  for (const c of contents) {
    space.addContent(new EventLocationSpaceContent(c.language, c.name, c.accessibilityInfo ?? ''));
  }
  if (typeof eventCount === 'number') {
    space.eventCount = eventCount;
  }
  return space;
};

/**
 * Module-level "next staged Space name" used by the EditSpaceStub when it
 * emits `save`. Tests can write to this variable BEFORE clicking the stub's
 * Save button to control what name the staged payload carries — used by the
 * add-case and (new) affordance assertions.
 *
 * Default value ('Stub Space') keeps tests that don't care about the name
 * working unchanged. Reset in `beforeEach`.
 */
let nextStagedSpaceName = 'Stub Space';

/**
 * Stub for the EditSpace child. The real component is tested independently
 * (`edit-space.test.ts`); stubbing it isolates these tests to SpacesEditor's
 * staging buffer + emit contract.
 *
 * The stub mirrors the real child's emit contract: it emits `save` with a
 * freshly-built `EventLocationSpace` carrying per-language content. When the
 * `space` prop is set (edit mode), the staged payload preserves the source
 * row's `id`, `placeId`, and `clientId` so SpacesEditor's edit-merge path is
 * exercised. The staged name is read from the module-level
 * `nextStagedSpaceName` so tests can target specific names.
 */
const EditSpaceStub = {
  name: 'EditSpace',
  props: ['space'],
  emits: ['save', 'cancel'],
  methods: {
    buildStaged(this: { space?: EventLocationSpace | null }): EventLocationSpace {
      const source = this.space ?? null;
      const staged = new EventLocationSpace(
        source?.id || undefined,
        source?.placeId || undefined,
      );
      if (source?.clientId) staged.clientId = source.clientId;
      const name = source ? source.content('en').name : nextStagedSpaceName;
      staged.addContent(new EventLocationSpaceContent('en', name, ''));
      return staged;
    },
  },
  template: `
    <div class="space-editor">
      <button type="button" class="btn-cancel" @click="$emit('cancel')">Cancel</button>
      <button type="button" class="btn-save" @click="$emit('save', buildStaged())">Save</button>
    </div>
  `,
};

const mountSpacesEditor = async (
  props: { spaces: EventLocationSpace[] },
) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: {} }],
  });
  await router.push('/');
  await router.isReady();

  const pinia = createPinia();
  setActivePinia(pinia);

  const wrapper = mountComponent(SpacesEditor, router, {
    props,
    pinia,
    stubs: {
      EditSpace: EditSpaceStub,
    },
  });

  await flushPromises();
  return wrapper;
};

describe('SpacesEditor', () => {
  beforeEach(() => {
    nextStagedSpaceName = 'Stub Space';
  });

  describe('Add case', () => {
    it('emits update:spaces with a new entry carrying a clientId on Add then Save', async () => {
      const wrapper = await mountSpacesEditor({ spaces: [] });

      // Click "Add room or space" to open the inline editor.
      await wrapper.find('.add-space-button').trigger('click');
      await flushPromises();

      expect(wrapper.find('.space-editor').exists()).toBe(true);

      // Stub's "Save" button emits a fresh EventLocationSpace with our chosen name.
      nextStagedSpaceName = 'Pacific Room';
      await wrapper.find('.space-editor .btn-save').trigger('click');
      await flushPromises();

      const emissions = wrapper.emitted('update:spaces');
      expect(emissions).toBeTruthy();
      expect(emissions).toHaveLength(1);

      const last = emissions![emissions!.length - 1][0] as EventLocationSpace[];
      expect(last).toHaveLength(1);
      // Staged row: blank server id, but a fresh clientId stamped by SpacesEditor.
      expect(last[0].id).toBe('');
      expect(last[0].clientId).toBeTruthy();
      expect(typeof last[0].clientId).toBe('string');
      expect(last[0].content('en').name).toBe('Pacific Room');

      // No remove-space emission on the add path.
      expect(wrapper.emitted('remove-space')).toBeFalsy();
    });

    it('appends to an existing list rather than replacing it', async () => {
      const existing = createMockSpace('space-1', 'place-1', [
        { language: 'en', name: 'Pacific Room' },
      ]);
      const wrapper = await mountSpacesEditor({ spaces: [existing] });

      nextStagedSpaceName = 'Atlantic Room';
      await wrapper.find('.add-space-button').trigger('click');
      await flushPromises();
      await wrapper.find('.space-editor .btn-save').trigger('click');
      await flushPromises();

      const last = wrapper.emitted('update:spaces')!.at(-1)![0] as EventLocationSpace[];
      expect(last).toHaveLength(2);
      // Original row identity preserved at index 0.
      expect(last[0].id).toBe('space-1');
      // New staged row appended at index 1 with a clientId.
      expect(last[1].id).toBe('');
      expect(last[1].clientId).toBeTruthy();
      expect(last[1].content('en').name).toBe('Atlantic Room');
    });
  });

  describe('Edit case', () => {
    it('emits update:spaces replacing the existing row in place on Edit then Save', async () => {
      const existing = createMockSpace('space-1', 'place-1', [
        { language: 'en', name: 'Pacific Room' },
      ]);
      const wrapper = await mountSpacesEditor({ spaces: [existing] });

      // Click the row's edit button to open the inline editor in edit mode.
      await wrapper.find('.space-item .edit-space-button').trigger('click');
      await flushPromises();

      // The stub preserves the source row's id+placeId and re-emits with the
      // existing content — exercising the in-place replace path.
      await wrapper.find('.space-editor .btn-save').trigger('click');
      await flushPromises();

      const emissions = wrapper.emitted('update:spaces');
      expect(emissions).toBeTruthy();
      const last = emissions![emissions!.length - 1][0] as EventLocationSpace[];
      // Replace, not append.
      expect(last).toHaveLength(1);
      // Identity preserved on the replaced row.
      expect(last[0].id).toBe('space-1');
      expect(last[0].placeId).toBe('place-1');
      expect(last[0].content('en').name).toBe('Pacific Room');

      // Edit must not emit remove-space.
      expect(wrapper.emitted('remove-space')).toBeFalsy();
    });

    it('preserves a staged row clientId across the in-place replace', async () => {
      const staged = createMockSpace('', 'place-1', [
        { language: 'en', name: 'Pacific Room' },
      ]);
      staged.clientId = 'client-abc';
      const wrapper = await mountSpacesEditor({ spaces: [staged] });

      await wrapper.find('.space-item .edit-space-button').trigger('click');
      await flushPromises();
      await wrapper.find('.space-editor .btn-save').trigger('click');
      await flushPromises();

      const last = wrapper.emitted('update:spaces')!.at(-1)![0] as EventLocationSpace[];
      expect(last).toHaveLength(1);
      // Staged row remains staged (no server id) and keeps its clientId so
      // the post-save reassign loop can still translate it to a server id.
      expect(last[0].id).toBe('');
      expect(last[0].clientId).toBe('client-abc');
    });
  });

  describe('Remove case', () => {
    it('emits remove-space when the user clicks delete on a saved row', async () => {
      const existing = createMockSpace('space-1', 'place-1', [
        { language: 'en', name: 'Pacific Room' },
      ]);
      const wrapper = await mountSpacesEditor({ spaces: [existing] });

      await wrapper.find('.space-item .delete-space-button').trigger('click');
      await flushPromises();

      const emissions = wrapper.emitted('remove-space');
      expect(emissions).toBeTruthy();
      expect(emissions).toHaveLength(1);
      expect((emissions![0][0] as EventLocationSpace).id).toBe('space-1');

      // Crucially: SpacesEditor must NOT auto-mutate the array. The parent
      // owns the removal decision (e.g., reassign-events dialog gating).
      expect(wrapper.emitted('update:spaces')).toBeFalsy();
    });

    it('emits remove-space identically for staged (clientId-only) rows', async () => {
      const staged = createMockSpace('', 'place-1', [
        { language: 'en', name: 'Atlantic Room' },
      ]);
      staged.clientId = 'client-abc';
      const wrapper = await mountSpacesEditor({ spaces: [staged] });

      await wrapper.find('.space-item .delete-space-button').trigger('click');
      await flushPromises();

      const emissions = wrapper.emitted('remove-space');
      expect(emissions).toBeTruthy();
      expect(emissions).toHaveLength(1);
      const removed = emissions![0][0] as EventLocationSpace;
      expect(removed.id).toBe('');
      expect(removed.clientId).toBe('client-abc');

      // Staged removal also defers to the parent — no auto-mutation.
      expect(wrapper.emitted('update:spaces')).toBeFalsy();
    });
  });

  describe('(new) affordance', () => {
    it('renders the (new) affordance for staged rows and not for saved rows', async () => {
      const staged = createMockSpace('', 'place-1', [
        { language: 'en', name: 'Atlantic Room' },
      ]);
      staged.clientId = 'client-abc';
      const saved = createMockSpace('space-1', 'place-1', [
        { language: 'en', name: 'Pacific Room' },
      ]);

      const wrapper = await mountSpacesEditor({ spaces: [staged, saved] });

      const items = wrapper.findAll('.space-item');
      expect(items).toHaveLength(2);

      const stagedRow = items.find(i => i.text().includes('Atlantic Room'));
      const savedRow = items.find(i => i.text().includes('Pacific Room'));
      expect(stagedRow).toBeTruthy();
      expect(savedRow).toBeTruthy();

      // Staged row carries the resolved "(new)" copy from
      // calendars.places.space.reassign_new_suffix.
      const affordance = stagedRow!.find('.space-info__new-affordance');
      expect(affordance.exists()).toBe(true);
      expect(affordance.text()).toBe('(new)');

      // Saved row does NOT carry the affordance.
      expect(savedRow!.find('.space-info__new-affordance').exists()).toBe(false);
    });

    it('drops the (new) affordance after the parent re-emits the row with a server id', async () => {
      const staged = createMockSpace('', 'place-1', [
        { language: 'en', name: 'Pacific Room' },
      ]);
      staged.clientId = 'client-abc';
      const wrapper = await mountSpacesEditor({ spaces: [staged] });

      // Sanity: staged row currently shows the affordance.
      expect(
        wrapper.find('.space-item .space-info__new-affordance').exists(),
      ).toBe(true);

      // Simulate the parent committing the save: the same row is re-passed
      // with a server-assigned id.
      const saved = createMockSpace('server-fresh', 'place-1', [
        { language: 'en', name: 'Pacific Room' },
      ]);
      await wrapper.setProps({ spaces: [saved] });
      await flushPromises();

      expect(
        wrapper.find('.space-item .space-info__new-affordance').exists(),
      ).toBe(false);
    });
  });

  describe('Empty state', () => {
    it('renders the empty-state copy when given an empty spaces array', async () => {
      const wrapper = await mountSpacesEditor({ spaces: [] });

      const empty = wrapper.find('.spaces-empty');
      expect(empty.exists()).toBe(true);
      expect(empty.text()).toBe('No rooms or spaces yet');
      expect(wrapper.find('.space-list').exists()).toBe(false);
    });

    it('hides the empty-state copy while the inline create editor is open', async () => {
      const wrapper = await mountSpacesEditor({ spaces: [] });

      await wrapper.find('.add-space-button').trigger('click');
      await flushPromises();

      expect(wrapper.find('.spaces-empty').exists()).toBe(false);
      expect(wrapper.find('.space-editor').exists()).toBe(true);
    });
  });
});
