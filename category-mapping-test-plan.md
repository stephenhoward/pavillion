# Category Mapping Feature Test Plan
> Epic: pv-2l4h — Category mapping from reposted events
> Last Updated: 2026-02-18 (updated after fix round 1)

## Setup

The app runs locally:
- Frontend: http://localhost:3000
- Login: `admin@pavillion.dev` / `admin`
- The admin owns `test_calendar`

**Seed data pre-configures:**
- `testuser_calendar` (owned by TestUser) has 4 categories: Music, Film, Outdoors, Food & Drink
- `test_calendar` follows `testuser_calendar` with auto_repost_originals=true
- Two category mappings are pre-seeded: Music→Entertainment, Film→Arts
- Outdoors and Food & Drink are intentionally unmapped (to test the repost-categories modal)

**Fixed bugs (closed — behavior should now work correctly):**
| Bug ID | Summary |
|--------|---------|
| pv-2l4h.10 | Category mapping API uses human-readable actorId; backend expects UUID — FIXED |
| pv-2l4h.11 | Category Mappings page has no back button or breadcrumb — FIXED |
| pv-2l4h.14 | Feed event cards show no date — FIXED |
| pv-2l4h.15 | Feed event cards show 'Unknown' for source calendar — FIXED |
| pv-idwd | Category mappings save fails with 400 Bad Request (seed UUIDs not v4) — FIXED |
| pv-2l4h.12 | Manual repost fails with InvalidSharedEventUrlError (relative event_source_url) — FIXED |
| pv-2l4h.13 | Category IDs from manual repost not passed to backend — FIXED |
| pv-2l4h.8 | Feed page blank on direct URL navigation — FIXED |
| pv-2l4h.9 | 'Follow a Calendar' button doesn't auto-open Add Calendar modal — FIXED |
| pv-2l4h.16 | Re-following an already-followed calendar silently resets auto-repost settings — FIXED |

**Known bugs (still open — skip if hit, don't re-file):**

All previously known bugs are now fixed. No skips required.

---

## Phase 1: Login

**Step 1.1** Navigate to `http://localhost:3000`
- Expected: Login page (or already logged in)

**Step 1.2** Log in with `admin@pavillion.dev` / `admin`
- Expected: Redirects to calendar dashboard

---

## Phase 2: Feed Navigation + Calendar Selection

**Step 2.1** Click "Feed" in the left sidebar — do NOT navigate to `/feed` directly (pv-2l4h.8)
- Expected: Feed page loads with a calendar selector and Events/Following tabs

**Step 2.2** Select `test_calendar` from the calendar selector
- Expected: Feed loads for test_calendar showing Events and Following tabs

---

## Phase 3: Events Tab — Observe Feed Cards

**Step 3.1** Look at the Events tab (should be default)
- Note: Are events listed? (They should be — test_calendar follows testuser_calendar)
- Note: Do event cards show dates? (Fixed pv-2l4h.14 — dates should be visible)
- Note: Do event cards show source calendar? (Fixed pv-2l4h.15 — should show calendar name)
- Take screenshot; continue regardless

**Step 3.2** Attempt to repost an event
- Click "Repost" on any visible event card
- Expected (pv-2l4h.12 fixed): Category mapping modal appears OR event reposts silently
- Take screenshot; continue regardless

**Step 3.3** Test unmapped category repost dialog (now unblocked — pv-2l4h.12 fixed)
- Find events from testuser_calendar that have Outdoors or Food & Drink categories
- Click "Repost" on such an event
- Expected: repost-categories-modal opens showing mapped categories pre-selected and
  unmapped ones (Outdoors/Food & Drink) available to add
- Take screenshot

---

## Phase 4: Events Tab — "Follow a Calendar" Empty State

**Step 4.1** Check whether the Events tab shows an empty state with a "Follow a Calendar" button
- If no events visible: click the "Follow a Calendar" button
- Known bug pv-2l4h.9: Clicking it switches to the Following tab WITHOUT opening the modal
- Take screenshot; continue

---

## Phase 5: Following Tab — View Existing Follows

**Step 5.1** Click the "Following" tab
- Expected: List shows at least one entry — `testuser_calendar@pavillion.dev`
  (pre-seeded with auto_repost_originals=true, so BOTH auto-repost toggles should be visible)
- Take screenshot

**Step 5.2** Inspect the follow list item for `testuser_calendar@pavillion.dev`
- Note: Is the calendarActorId shown as `testuser_calendar@pavillion.dev`?
- Note: Is "Auto-repost original events" toggle visible and ON?
- Note: Is "Also auto-repost shared events" toggle visible? (Only shows when originals=ON)
- Note: Is there a "Category mappings" link?
- Take screenshot

---

## Phase 6: Add Calendar Modal — Follow Flow

**Step 6.1** Click "Add a Calendar" button in the Following tab
- Expected: Modal opens titled "Add a Calendar"

**Step 6.2** Enter the calendar identifier
- Type: `testuser_calendar@pavillion.dev`
  (NOTE: `testuser_calendar@localhost` is NOT valid — local dev uses `pavillion.dev` domain)
- Wait ~1 second for debounced lookup
- Expected: Calendar Preview section appears with Name and Domain

**Step 6.3** Inspect the auto-repost policy section
- Note: Is there a toggle for "Auto-repost original events"?
- Enable "Auto-repost original events"
- Note: Does "Also auto-repost shared events" appear?
  (It's conditional — only shows when originals is ON)

**Step 6.4** Do NOT click Follow yet — first verify the lookup preview content
- Expected: Name = something readable (e.g., "Test User's Calendar")
- Expected: Domain = "pavillion.dev" or "localhost"
- Take screenshot of full modal

**Step 6.5** Click the Follow button
- Expected path A (bug pv-2l4h.10 unfixed): Modal closes immediately, no mapping step shown
  - The source-categories API call fails (returns 404 because actorId is human-readable, not UUID)
  - The `loadMappingStep` catch block silently closes the modal
- Expected path B (bug pv-2l4h.10 fixed): Modal transitions to "Map Categories" step
  showing testuser_calendar's 4 categories (Music, Film, Outdoors, Food & Drink)
  with a dropdown for each to assign a local category
- Take screenshot of what actually happens

---

## Phase 7: Category Mappings Settings Page

**Step 7.1** In the Following tab, click the "Category mappings" link on the follow entry
- Expected URL: `/calendar/c71f5c9e-7a3d-4e5f-8e1a-66c3612a05f3/following/[actorId]/category-mappings`
- Note: What is the actorId in the URL? UUID or human-readable string?
- Known bug pv-2l4h.10: If actorId is human-readable, page shows "Failed to load category data" error
- Take screenshot

**Step 7.2** Observe the page layout
- Is there a back button or breadcrumb to return to the Following tab?
  (Known bug pv-2l4h.11 = no back navigation)
- Does the sidebar highlight "Feed" or "Calendar"? (pv-2l4h.11 = Calendar highlighted, which is wrong)
- Take screenshot

**Step 7.3** Page loads and save works (pv-2l4h.10 and pv-idwd both fixed):
- Expected: Category mapping editor shows testuser_calendar's 4 source categories
- Expected: Music is pre-mapped to Entertainment (shown as "Entretenimiento" in Spanish locale), Film is pre-mapped to Arts
- Expected: Outdoors and Food & Drink have no mapping (dropdowns empty)
- Map Outdoors to any local category and click "Save mappings"
- Expected: "Mappings saved" success message appears
- Take screenshot of success state
- If save fails with 400, STOP and report — this would be a regression

---

## Phase 8: Calendar Settings — Alternate Access

**Step 8.1** Navigate to Calendar Settings for test_calendar (via sidebar or URL)
- Expected URL pattern: `/calendar/test_calendar/manage`

**Step 8.2** Look for a "Category Mappings" or "Following" tab in settings
- Note: Does any settings tab provide access to category mappings?
- As of testing: No such tab exists (Settings tab only has "Default Date Filter")
- This may be expected — the spec says mappings are accessible from the following list,
  not necessarily from calendar settings

---

## Phase 9: Inline Mapping Step After Follow (Target Scenario)

All blocking bugs (pv-2l4h.10, .16) are now fixed — this phase is fully testable.

**Step 9.1** Unfollow testuser_calendar first
- In the Following tab, click "Unfollow" on the testuser_calendar entry
- Confirm the unfollow

**Step 9.2** Re-follow testuser_calendar@pavillion.dev
- Click "Add a Calendar", type `testuser_calendar@pavillion.dev`
- After following, the mapping step SHOULD appear

**Step 9.3** In the mapping step
- Expected: Shows testuser_calendar's 4 categories: Music, Film, Outdoors, Food & Drink
- Expected: Dropdowns to select local test_calendar categories
- Map Music → Entertainment (or similar)
- Leave Outdoors unmapped
- Click "Save Mappings"
- Expected: Modal closes, follow is in the list, mappings are saved

**Step 9.4** Verify saved mappings
- Navigate to Category Mappings settings page for testuser_calendar
- Verify the mapping created in step 9.3 is listed

---

## Phase 10: Manual Repost with Category Dialog (Target Scenario)

pv-2l4h.12 is now fixed — this phase is unblocked.

**Step 10.1** Go to Events tab
- Find an event from testuser_calendar that has an Outdoors or Food & Drink category
  (these are intentionally unmapped in the seed data)

**Step 10.2** Click "Repost" on that event
- Expected: repost-categories-modal opens (because some categories are unmapped)
- Expected: Pre-selected categories shown for the mapped ones
- Expected: User can add/remove categories before confirming
- Take screenshot of modal

**Step 10.3** Confirm the repost
- Click the confirm button in the modal
- Expected: Event reposts successfully to test_calendar with the selected categories

**Step 10.4** Verify the reposted event has correct categories
- Navigate to test_calendar's event list
- Find the newly reposted event
- Check that the categories assigned match what was selected in step 10.2

---

## Phase 11: Manual Repost — All Categories Mapped (Silent Repost)

pv-2l4h.12 is now fixed — this phase is unblocked.

**Step 11.1** Find an event from testuser_calendar with only Music or Film category
  (these map to Entertainment and Arts respectively — fully mapped)

**Step 11.2** Click "Repost" on that event
- Expected: No dialog shown — event reposts silently with the mapped categories applied
- Expected: A success toast or confirmation appears

**Step 11.3** Verify the reposted event on test_calendar
- Categories should be Entertainment (from Music) or Arts (from Film)

---

## Reporting Instructions

After each phase, note:
1. Did the step succeed as expected?
2. If not, what error or unexpected behavior occurred?
3. Is it a known bug (see list above) or something new?
4. For new bugs: what you did, what you expected, what actually happened

**Stop and report back if:**
- Something unexpected happens that isn't in the known bugs list
- You're unsure whether a behavior is a bug or expected
- A step gives an unexpected error that blocks further testing

**Don't stop for:**
- All previously known bugs are fixed — no planned skips remain
- Stop if something unexpected blocks you and report back
