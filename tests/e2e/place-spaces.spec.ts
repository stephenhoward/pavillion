import { test, expect, Page } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Test: Place + Spaces full scenario (pv-ix7v.5.1)
 *
 * Single end-to-end scenario that exercises the complete Place + Spaces stack:
 *
 *   1. Log in as admin and create a "Convention Center" Place via the editor.
 *   2. Open the same Place in edit mode and add two Spaces:
 *        - "Pacific Room" with "Hearing loop available" accessibility info
 *        - "Council Chambers" (no accessibility info)
 *   3. Create an event and pick "Convention Center — Pacific Room" via the
 *      flat picker entry.
 *   4. Visit the public detail page at /view/<cal>/events/<eventId> and
 *      assert:
 *        - The location header shows "Convention Center — Pacific Room"
 *          (concatenated header from `place.format.with_space`).
 *        - The space-accessibility section shows the Hearing loop text.
 *   5. Edit the event back to (whole venue) by re-opening the picker and
 *      selecting the "Convention Center (whole venue)" entry.
 *   6. Reload the public detail and assert:
 *        - The location header now shows "Convention Center" alone (positive
 *          assertion paired with the absence-of-Pacific-Room negative, per
 *          testing-advisor LOW finding).
 *        - The `.accessibility-section--space` block is hidden (.not.toBeVisible()).
 *   7. Re-edit the SAME event and switch to a DIFFERENT Space ("Council Chambers")
 *      to exercise the exact broken path from pv-on9o (edit existing event,
 *      pick a Space, save — was silently clearing space_id before the fix).
 *   8. Reload the public detail and assert:
 *        - The location header shows "Convention Center — Council Chambers".
 *        - The `.accessibility-section--space` block is visible (no accessibility
 *          text for Council Chambers, but the section should be present/absent
 *          depending on the template implementation — assert the header).
 *
 * Uses the shared isolated test-server harness (in-memory SQLite, fresh seeded
 * admin@pavillion.dev / test_calendar). The test runs serially (single-test
 * file already implies one worker per file).
 *
 * Related:
 *   - Bead: pv-ix7v.5.1 (parent epic pv-ix7v)
 *   - Bug fix: pv-on9o (Space silently dropped on re-edit of existing event)
 */

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });

const ADMIN_CALENDAR = 'test_calendar';
const PLACE_NAME = 'Convention Center';
const SPACE_PACIFIC = 'Pacific Room';
const SPACE_COUNCIL = 'Council Chambers';
const PACIFIC_ACCESSIBILITY = 'Hearing loop available throughout';
const EVENT_TITLE = `Place+Spaces E2E ${Date.now()}`;
const CONCATENATED_HEADER = `${PLACE_NAME} — ${SPACE_PACIFIC}`;

/**
 * Open the Places tab on the admin's seeded calendar via direct URL navigation.
 * Direct navigation is more deterministic than tab-clicking when the page may
 * be partway through hydration.
 */
async function gotoPlacesTab(page: Page) {
  await page.goto(`${env.baseURL}/calendar/${ADMIN_CALENDAR}?tab=places`);
  // Wait for either the empty state or the populated places list.
  await page.waitForSelector('.places-content, .empty-layout, [class*="empty"]', {
    timeout: 15000,
  });
}

/**
 * Create a Place via the place editor reachable from the Places tab.
 * Returns the newly-created Place's ID, parsed from the URL after navigation
 * back to the Places tab fails (we land on /calendar/<cal>?tab=places after
 * save; the ID is recovered from the rendered places list via the edit button
 * data, since the editor returns to the tab without exposing the ID directly).
 */
async function createPlace(page: Page, name: string): Promise<void> {
  await gotoPlacesTab(page);

  // The "Add Place" button lives in both the populated header and the empty
  // state. Either one navigates to the new-place editor.
  const addButton = page.getByRole('button', { name: /add place/i });
  await addButton.first().click();

  // Wait for the place editor to render its name input.
  await page.waitForSelector('#place-name', { timeout: 10000 });

  // Fill the name and save. Address fields are optional for this scenario.
  await page.locator('#place-name').fill(name);

  // Save uses the form submit button in the page header.
  await page.getByRole('button', { name: /^save$/i }).click();

  // After save, edit-place.vue navigates to /calendar/<cal>?tab=places.
  await page.waitForURL(`**/calendar/${ADMIN_CALENDAR}**`, { timeout: 15000 });
}

/**
 * Open the most-recently-created Place for editing. The place-tab lists
 * Places in creation order; we filter by name to find ours and click the
 * Pencil edit button (aria-label = "Edit <name>").
 */
async function openPlaceForEditing(page: Page, name: string): Promise<void> {
  await gotoPlacesTab(page);

  // Find the place card with our name.
  const placeCard = page.locator('.place-card').filter({ hasText: name });
  await expect(placeCard).toBeVisible({ timeout: 10000 });

  // Click the edit (pencil) icon button. aria-label is "Edit <name>" via i18n.
  const editButton = placeCard.locator(`button[aria-label*="${name}"]`).first();
  await editButton.click();

  // Wait for the URL to advance to the place-edit route. The button uses
  // router.push so the navigation is synchronous client-side.
  await page.waitForURL(/\/places\/[^/]+$/, { timeout: 10000 });

  // Wait for the editor to finish loading (the loading container is replaced
  // by <main class="editor-main">).
  await page.waitForSelector('main.editor-main', { timeout: 10000 });

  // Wait for the place editor's Spaces section to be present (only renders in
  // edit mode, so its presence confirms we're editing rather than creating).
  await page.waitForSelector('.spaces-section', { timeout: 10000 });
}

/**
 * Add a Space to the currently-open Place editor. Optionally fills the
 * accessibility info textarea for the default (en) language.
 */
async function addSpace(page: Page, name: string, accessibility?: string): Promise<void> {
  // Click "Add space" to mount the inline EditSpace editor. The button is
  // hidden once the editor is open, so we re-click the latest visible one
  // each time.
  const addButton = page.locator('.add-space-button').filter({ visible: true });
  await addButton.click();

  // Wait for the inline space editor to render.
  await page.waitForSelector('.space-editor-form', { timeout: 5000 });

  // Fill the per-language name (default lang is 'en').
  await page.locator('#space-name-en').fill(name);

  if (accessibility) {
    await page.locator('#space-accessibility-en').fill(accessibility);
  }

  // Save the space. The inline editor's submit button is labelled "Done" per
  // the child-emits-data refactor (pv-0pht.8) — clicking it stages the Space
  // into the parent's `place.spaces` working buffer; the actual server commit
  // fires when the parent Place form is saved.
  await page.locator('.space-editor-form').getByRole('button', { name: /^done$/i }).click();

  // Wait for the inline editor to unmount (parent closes it on save success).
  await page.waitForSelector('.space-editor-form', { state: 'detached', timeout: 10000 });

  // Verify the space appears in the list.
  const spaceList = page.locator('.space-list .space-item').filter({ hasText: name });
  await expect(spaceList).toBeVisible({ timeout: 5000 });
}

/**
 * Create an event on the admin's calendar. Returns the created event's UUID,
 * extracted from the URL when the editor is re-opened from the events tab.
 */
async function createEventWithLocation(
  page: Page,
  title: string,
  pickerEntryName: string,
): Promise<string> {
  // Navigate to the events tab on the calendar.
  await page.goto(`${env.baseURL}/calendar/${ADMIN_CALENDAR}`);
  await page.waitForSelector('.event-list, [class*="empty"]', { timeout: 15000 });

  // Click "Create an Event".
  await page.getByRole('button', { name: /create an event/i }).click();
  await page.waitForSelector('#event-form', { timeout: 10000 });

  // Fill the event title.
  await page.locator('#event-name-en').fill(title);

  // Fill in date/time so the event is well-formed.
  await page.locator('.schedule-grid input[type="date"]').first().fill('2026-08-15');
  await page.locator('.schedule-grid input[type="time"]').first().fill('14:00');

  // Open the location picker.
  await page.getByRole('button', { name: /add location/i }).click();
  await page.waitForSelector('dialog.sheet-dialog[open]', { timeout: 5000 });

  // Pick the entry whose displayed name matches the requested label.
  await selectPickerEntry(page, pickerEntryName);

  // Save the event.
  await page.locator('button.btn-save').click();

  // Wait to land back on the calendar events tab.
  await page.waitForURL(`**/calendar/${ADMIN_CALENDAR}`, { timeout: 15000 });
  await page.waitForSelector('.event-list', { timeout: 10000 });

  // Look up the newly-created event's id via the rendered title id attribute.
  const eventArticle = page.locator('.event-item').filter({ hasText: title }).first();
  await expect(eventArticle).toBeVisible({ timeout: 10000 });

  const titleHeading = eventArticle.locator('h3').first();
  const titleId = await titleHeading.getAttribute('id');
  if (!titleId || !titleId.startsWith('event-title-')) {
    throw new Error(`Could not extract event id from title heading id="${titleId}"`);
  }
  return titleId.substring('event-title-'.length);
}

/**
 * Click the picker entry whose visible display name matches `entryName`. The
 * entry is matched against the rendered text inside `.location-name`, which
 * carries either the bare Place name or the concatenated "Place — Space"
 * string (or "Place (whole venue)").
 */
async function selectPickerEntry(page: Page, entryName: string): Promise<void> {
  // Match the entry by its exact rendered location-name text to avoid
  // ambiguity. We click the parent .location-item (the role="button" surface)
  // rather than the inner .location-name, since the click handler is bound on
  // the parent in the picker template.
  const nameLocator = page.locator('.location-item .location-name', { hasText: entryName });
  await expect(nameLocator.first()).toBeVisible({ timeout: 5000 });

  // Walk up to the .location-item parent (the click target).
  const itemLocator = nameLocator.first().locator('xpath=ancestor::*[contains(@class, "location-item")][1]');
  await itemLocator.click();

  // The picker closes itself on selection.
  await page.waitForSelector('dialog.sheet-dialog[open]', { state: 'detached', timeout: 5000 });
}

/**
 * Open an existing event in the editor (eventId is a UUID). Used to switch
 * the event's location from (Place, Space) to (whole venue).
 */
async function editEvent(page: Page, eventId: string): Promise<void> {
  await page.goto(`${env.baseURL}/event/${eventId}`);
  await page.waitForSelector('#event-form', { timeout: 10000 });
}

/**
 * Stage a Space inline on the currently-open Place editor WITHOUT clicking
 * the parent Save afterwards. Used by the atomic-save E2E that commits the
 * entire Place + Spaces tree in a single save action. Mirrors `addSpace`
 * but skips the existence-in-list assertion against persisted server data —
 * a freshly-staged Space is in the working buffer only and the assertion
 * after parent Save covers persistence.
 */
async function stageSpaceInline(
  page: Page,
  name: string,
  accessibility?: string,
): Promise<void> {
  const addButton = page.locator('.add-space-button').filter({ visible: true });
  await addButton.click();
  await page.waitForSelector('.space-editor-form', { timeout: 5000 });
  await page.locator('#space-name-en').fill(name);
  if (accessibility) {
    await page.locator('#space-accessibility-en').fill(accessibility);
  }
  await page.locator('.space-editor-form').getByRole('button', { name: /^done$/i }).click();
  // Editor unmounts on stage; the row appears in the parent's working buffer.
  await page.waitForSelector('.space-editor-form', { state: 'detached', timeout: 10000 });
  // Sanity: the row is visible in the staging list with the (new) affordance.
  const stagedRow = page.locator('.space-list .space-item').filter({ hasText: name });
  await expect(stagedRow).toBeVisible({ timeout: 5000 });
  await expect(stagedRow.locator('.space-info__new-affordance')).toBeVisible();
}

test.describe('Place + Spaces full scenario', () => {
  test.beforeAll(async () => {
    env = await startTestServer();
  });

  test.afterAll(async () => {
    if (env?.cleanup) {
      await env.cleanup();
    }
  });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
  });

  test('creates Place + Spaces, picks Space on event, then switches to whole-venue', async ({ page }) => {
    // 1. Create the Convention Center Place.
    await createPlace(page, PLACE_NAME);

    // 2. Open the Place for editing and add the two Spaces.
    await openPlaceForEditing(page, PLACE_NAME);
    await addSpace(page, SPACE_PACIFIC, PACIFIC_ACCESSIBILITY);
    await addSpace(page, SPACE_COUNCIL);

    // Verify both Spaces are listed in the editor.
    await expect(
      page.locator('.space-list .space-item').filter({ hasText: SPACE_PACIFIC }),
    ).toBeVisible();
    await expect(
      page.locator('.space-list .space-item').filter({ hasText: SPACE_COUNCIL }),
    ).toBeVisible();

    // Save the Place form to commit the staged Spaces. With the pv-0pht atomic
    // save model, addSpace() only stages a Space in the client working buffer;
    // the parent Save is what writes them to the server. Without this click,
    // step 3's location picker would not see any Spaces (the server never
    // received them).
    await page.getByRole('button', { name: /^save$/i }).click();
    await page.waitForURL(`**/calendar/${ADMIN_CALENDAR}**`, { timeout: 15000 });

    // 3. Create an event picking the Pacific Room space entry.
    const eventId = await createEventWithLocation(
      page,
      EVENT_TITLE,
      CONCATENATED_HEADER,
    );

    // 4. Visit the public detail page and assert the layered display.
    await page.goto(`${env.baseURL}/view/${ADMIN_CALENDAR}/events/${eventId}`);
    await page.waitForSelector('.event-main', { timeout: 15000 });

    // Concatenated header: "Convention Center — Pacific Room".
    const locationName = page.locator('.event-location .location-name');
    await expect(locationName).toBeVisible();
    await expect(locationName).toContainText(CONCATENATED_HEADER);

    // Space-accessibility section is visible with the hearing-loop text. This
    // is the strong positive assertion for the layered accessibility surface.
    const spaceAccessibilitySection = page.locator('.accessibility-section--space');
    await expect(spaceAccessibilitySection).toBeVisible();
    await expect(spaceAccessibilitySection).toContainText(PACIFIC_ACCESSIBILITY);

    // 5. Switch the event to (whole venue) by re-opening the picker.
    await editEvent(page, eventId);

    // Click Change inside the LocationDisplayCard. We scope to the card so we
    // don't accidentally match a "Change Calendar" button or any other button
    // labelled "Change" elsewhere on the page.
    const locationCard = page.locator('.location-display-card');
    await expect(locationCard).toBeVisible({ timeout: 5000 });
    await locationCard.getByRole('button', { name: /^change$/i }).click();
    await page.waitForSelector('dialog.sheet-dialog[open]', { timeout: 5000 });

    // The whole-venue entry's visible label is "Convention Center (whole venue)".
    await selectPickerEntry(page, '(whole venue)');

    await page.locator('button.btn-save').click();
    await page.waitForURL(`**/calendar/${ADMIN_CALENDAR}`, { timeout: 15000 });

    // 6. Reload the public detail and assert whole-venue rendering.
    await page.goto(`${env.baseURL}/view/${ADMIN_CALENDAR}/events/${eventId}`);
    await page.waitForSelector('.event-main', { timeout: 15000 });

    const locationNameAfter = page.locator('.event-location .location-name');
    await expect(locationNameAfter).toBeVisible();

    // Positive assertion: the Place name is still rendered. Pairs with the
    // negative below to avoid the false-pass timing window flagged by the
    // testing-advisor LOW finding (.not.toContainText alone could pass before
    // the page rerenders).
    await expect(locationNameAfter).toContainText(PLACE_NAME);

    // Negative assertion: the Space name is no longer in the header.
    await expect(locationNameAfter).not.toContainText(SPACE_PACIFIC);

    // Strong assertion: the space-accessibility block is hidden entirely.
    const spaceAccessibilityAfter = page.locator('.accessibility-section--space');
    await expect(spaceAccessibilityAfter).not.toBeVisible();

    // 7. Re-edit the same event and switch to a DIFFERENT Space ("Council Chambers").
    //    This is the exact broken path from pv-on9o: edit an existing event (not
    //    create), pick a Space, save — the prior bug silently cleared space_id.
    await editEvent(page, eventId);

    const locationCard2 = page.locator('.location-display-card');
    await expect(locationCard2).toBeVisible({ timeout: 5000 });
    await locationCard2.getByRole('button', { name: /^change$/i }).click();
    await page.waitForSelector('dialog.sheet-dialog[open]', { timeout: 5000 });

    // Pick the Council Chambers entry (the second space).
    const councilHeader = `${PLACE_NAME} — ${SPACE_COUNCIL}`;
    await selectPickerEntry(page, councilHeader);

    await page.locator('button.btn-save').click();
    await page.waitForURL(`**/calendar/${ADMIN_CALENDAR}`, { timeout: 15000 });

    // 8. Reload the public detail and assert that Council Chambers is now the
    //    selected Space. Before the pv-on9o fix, the header would show only
    //    "Convention Center" (whole venue) because space_id was silently cleared.
    await page.goto(`${env.baseURL}/view/${ADMIN_CALENDAR}/events/${eventId}`);
    await page.waitForSelector('.event-main', { timeout: 15000 });

    const locationNameCouncil = page.locator('.event-location .location-name');
    await expect(locationNameCouncil).toBeVisible();

    // Positive assertion: the new Space name is in the header.
    await expect(locationNameCouncil).toContainText(councilHeader);

    // Negative assertion: the Pacific Room name is no longer in the header.
    await expect(locationNameCouncil).not.toContainText(SPACE_PACIFIC);
  });

  /**
   * E2E #1 (pv-0pht.11 AC): Create a Place + 2 Spaces from scratch in ONE
   * save action — the entire tree commits via a single POST. Verifies the
   * atomic save model end-to-end: no save-then-edit-again pattern.
   *
   * After save, opens the event picker and confirms both Space names appear
   * as selectable options, and that the (new) affordance is gone from any
   * staging list (it is only an editor-side concept and never leaks into
   * picker entries).
   */
  test('creates Place + 2 Spaces from scratch in one atomic save action', async ({ page }) => {
    const PLACE = `Atomic Place ${Date.now()}`;
    const SPACE_A = 'Sunrise Hall';
    const SPACE_B = 'Sunset Hall';

    // 1. Open the new-place editor directly. Skip createPlace() so the
    //    initial save commits Place + both Spaces atomically (one POST).
    await gotoPlacesTab(page);
    await page.getByRole('button', { name: /add place/i }).first().click();
    await page.waitForSelector('#place-name', { timeout: 10000 });

    // 2. Fill the place name and stage both Spaces (the Spaces section is
    //    visible in create mode per pv-0pht atomic save model).
    await page.locator('#place-name').fill(PLACE);
    await page.waitForSelector('.spaces-section', { timeout: 5000 });
    await stageSpaceInline(page, SPACE_A);
    await stageSpaceInline(page, SPACE_B);

    // 3. Single Save action commits Place + both Spaces atomically.
    await page.getByRole('button', { name: /^save$/i }).click();
    await page.waitForURL(`**/calendar/${ADMIN_CALENDAR}**`, { timeout: 15000 });

    // 4. Verify the Place is persisted by re-opening it; the Spaces list
    //    should show both server-persisted rows WITHOUT the (new) affordance
    //    (which only marks staged-but-unsaved rows in the working buffer).
    await openPlaceForEditing(page, PLACE);
    const persistedA = page.locator('.space-list .space-item').filter({ hasText: SPACE_A });
    const persistedB = page.locator('.space-list .space-item').filter({ hasText: SPACE_B });
    await expect(persistedA).toBeVisible({ timeout: 5000 });
    await expect(persistedB).toBeVisible({ timeout: 5000 });
    // Server-persisted rows do NOT carry the (new) affordance.
    await expect(persistedA.locator('.space-info__new-affordance')).toHaveCount(0);
    await expect(persistedB.locator('.space-info__new-affordance')).toHaveCount(0);

    // 5. Open the event picker and confirm both Space names appear as
    //    selectable entries (each Place + Space combo is a flat row).
    const eventTitle = `Atomic E2E ${Date.now()}`;
    await page.goto(`${env.baseURL}/calendar/${ADMIN_CALENDAR}`);
    await page.waitForSelector('.event-list, [class*="empty"]', { timeout: 15000 });
    await page.getByRole('button', { name: /create an event/i }).click();
    await page.waitForSelector('#event-form', { timeout: 10000 });
    await page.locator('#event-name-en').fill(eventTitle);
    await page.locator('.schedule-grid input[type="date"]').first().fill('2026-09-15');
    await page.locator('.schedule-grid input[type="time"]').first().fill('14:00');
    await page.getByRole('button', { name: /add location/i }).click();
    await page.waitForSelector('dialog.sheet-dialog[open]', { timeout: 5000 });

    // Both Space names appear in the picker (concatenated "Place — Space"
    // header strings). Match by partial text on .location-name to avoid
    // strict-equality flake against the em-dash separator.
    await expect(
      page.locator('.location-item .location-name', { hasText: SPACE_A }).first(),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator('.location-item .location-name', { hasText: SPACE_B }).first(),
    ).toBeVisible({ timeout: 5000 });

    // No (new) affordance leaks into the picker — that surface is editor-only.
    await expect(page.locator('.location-item .space-info__new-affordance')).toHaveCount(0);
  });

  /**
   * E2E #2 (pv-0pht.11 AC): Edit a Place, delete a Space that has events on
   * it, reassign those events to another Space in the same Place, save, and
   * verify the user-visible orchestration end-to-end:
   *   - The reassign dialog appears with the correct event-count prompt.
   *   - The dropdown lists the surviving Space as a target option.
   *   - After save, the source Space is removed from the Place's Spaces.
   *   - After save, the target Space remains and is selectable in the picker.
   *
   * Note: the reassign endpoint's effect on `events.space_id` is covered
   * exhaustively at the integration tier (`place_atomic_save.test.ts`
   * reassign-events happy-path); the e2e tier focuses on the editor-side
   * orchestration through the dialog.
   */
  test('edit Place: delete Space with 2 events, reassign to another Space', async ({ page }) => {
    const PLACE = `Reassign Place ${Date.now()}`;
    const SOURCE_SPACE = 'Old Hall';
    const TARGET_SPACE = 'New Hall';
    const EVENT_1 = `Reassign E1 ${Date.now()}`;
    const EVENT_2 = `Reassign E2 ${Date.now()}`;

    // 1. Create a Place with two Spaces atomically (single POST).
    await gotoPlacesTab(page);
    await page.getByRole('button', { name: /add place/i }).first().click();
    await page.waitForSelector('#place-name', { timeout: 10000 });
    await page.locator('#place-name').fill(PLACE);
    await page.waitForSelector('.spaces-section', { timeout: 5000 });
    await stageSpaceInline(page, SOURCE_SPACE);
    await stageSpaceInline(page, TARGET_SPACE);
    await page.getByRole('button', { name: /^save$/i }).click();
    await page.waitForURL(`**/calendar/${ADMIN_CALENDAR}**`, { timeout: 15000 });

    // 2. Create two events that both pick (PLACE, SOURCE_SPACE).
    const sourceHeader = `${PLACE} — ${SOURCE_SPACE}`;
    await createEventWithLocation(page, EVENT_1, sourceHeader);
    await createEventWithLocation(page, EVENT_2, sourceHeader);

    // 3. Re-open the Place for editing and trigger delete on the source Space.
    //    The reassign dialog should appear with eventCount > 0 prompt.
    await openPlaceForEditing(page, PLACE);
    const sourceRow = page.locator('.space-list .space-item').filter({ hasText: SOURCE_SPACE });
    await expect(sourceRow).toBeVisible({ timeout: 5000 });
    await sourceRow.locator('.delete-space-button').click();

    // The reassign dialog (eventCount > 0 branch) renders, NOT the plain
    // confirm dialog. Wait for the modal class.
    await page.waitForSelector('.reassign-space-modal', { timeout: 5000 });
    // Prompt copy carries the event count (we created 2 events on the source).
    await expect(page.locator('.reassign-space-modal')).toContainText('2 events use this room or space');

    // 4. Pick TARGET_SPACE in the dropdown. The dropdown excludes the Space
    //    being deleted (covered by component test); the test asserts via
    //    visible-text presence.
    const select = page.locator('.reassign-space-modal select');
    await expect(select).toBeVisible({ timeout: 5000 });
    const targetOption = select.locator('option', { hasText: TARGET_SPACE });
    const targetOptionValue = await targetOption.getAttribute('value');
    if (!targetOptionValue) {
      throw new Error('Target Space option had no value attribute');
    }
    await select.selectOption(targetOptionValue);

    // Confirm with the danger PillButton (label "Remove room or space").
    await page.locator('.reassign-space-modal').getByRole('button', { name: /^remove room or space$/i }).click();

    // The dialog closes and the source Space row is gone from the staging list.
    await page.waitForSelector('.reassign-space-modal', { state: 'detached', timeout: 5000 });
    await expect(
      page.locator('.space-list .space-item').filter({ hasText: SOURCE_SPACE }),
    ).toHaveCount(0);

    // 5. Save the parent Place form. The post-save reassign loop fires the
    //    server-side bulk reassign for the deleted Space's events.
    await page.getByRole('button', { name: /^save$/i }).click();
    await page.waitForURL(`**/calendar/${ADMIN_CALENDAR}**`, { timeout: 15000 });

    // 6. Re-open the Place and confirm:
    //    - source Space row is gone from the persisted spaces list
    //    - target Space row remains
    await openPlaceForEditing(page, PLACE);
    await expect(
      page.locator('.space-list .space-item').filter({ hasText: SOURCE_SPACE }),
    ).toHaveCount(0);
    await expect(
      page.locator('.space-list .space-item').filter({ hasText: TARGET_SPACE }),
    ).toBeVisible({ timeout: 5000 });

    // 7. Open an event picker on a fresh event and assert the target Space
    //    still appears as a valid picker entry (the source Space's entry has
    //    been removed from the picker because its row no longer exists).
    await page.goto(`${env.baseURL}/calendar/${ADMIN_CALENDAR}`);
    await page.waitForSelector('.event-list, [class*="empty"]', { timeout: 15000 });
    await page.getByRole('button', { name: /create an event/i }).click();
    await page.waitForSelector('#event-form', { timeout: 10000 });
    await page.getByRole('button', { name: /add location/i }).click();
    await page.waitForSelector('dialog.sheet-dialog[open]', { timeout: 5000 });

    // Target Space appears in the picker.
    await expect(
      page.locator('.location-item .location-name', { hasText: TARGET_SPACE }).first(),
    ).toBeVisible({ timeout: 5000 });

    // Source Space does NOT appear (it was deleted as part of the reassign).
    await expect(
      page.locator('.location-item .location-name', { hasText: SOURCE_SPACE }),
    ).toHaveCount(0);
  });
});
