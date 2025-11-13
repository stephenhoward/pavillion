# Spec Requirements: Location Management Fixes

## Initial Description

Fix critical bugs in the event location management system that were identified during QA testing. The QA report documented three critical bugs that are causing data loss, preventing valid data entry, and blocking user workflows.

## Requirements Discussion

### First Round Questions

Based on your idea for location management fixes, I had some clarifying questions:

**Q1:** Should this spec address all three critical bugs (LOC-001, LOC-002, LOC-003) or should we split them into separate specs?

**Answer:** Address all three bugs in one spec, but use separate commits for each fix.

**Q2:** For LOC-001 (Country field), I assume we should add the country field to both the model AND the UI form. Is that correct, or should we only fix the data loss issue in the model for now?

**Answer:** For now, just make the country field available in the model/entity. The decision to show it in the UI will be deferred.

**Q3:** For LOC-002 (Hierarchy validation), I'm thinking we should implement validation rules where more general location information requires more specific information to be filled in first. For example:
   - Name only: Valid
   - City requires address
   - State requires city AND address
   - Postal code requires state AND city AND address

   Should we use these rules, or do you have different hierarchy requirements?

**Answer:** Yes, use exactly those validation rules.

**Q4:** Should validation be implemented on the client-side (Vue components), server-side (API endpoints), or both?

**Answer:** Implement validation on BOTH client-side and server-side.

**Q5:** For validation errors, should we show all validation errors at once when the user tries to save, or show errors on blur as they fill in the form?

**Answer:** Show ALL validation errors at once when trying to save. Do NOT show errors on blur. Highlight problem fields in standard warning color.

**Q6:** For LOC-003 (404 error), since the root cause is unknown, I assume we should start by using Playwright MCP to reproduce the error and then investigate. Should we also:
   - Check the frontend event creation/editing component
   - Check the backend API endpoint responses
   - Look at both new location creation and editing existing locations

**Answer:** Yes to all of the above. Use Playwright MCP to reproduce first, then check both frontend and backend for both new and existing location scenarios.

**Q7:** Are there existing invalid locations in the database that need to be cleaned up, or is all current data test data that can be updated?

**Answer:** All current data is test data and can be updated. No migration needed.

**Q8:** For error messages when validation fails, what level of detail do you want? For example:
   - Brief: "City requires Address"
   - Detailed: "You must provide an Address before you can specify a City"

**Answer:** Clear and brief error messages like "City requires Address to be filled in".

**Q9:** Should this spec include the additional location features from the roadmap (autocomplete, bulk updates), or should those be deferred to a future spec?

**Answer:** Defer those features to future specs. Focus only on the three critical bugs.

**Q10:** What testing coverage do you expect for these fixes? Unit tests, integration tests, and/or e2e tests?

**Answer:**
- Unit tests for validation logic in service layer
- Integration tests for API validation
- Defer e2e tests (no Playwright tests in this spec)

### Existing Code to Reference

**Similar Features Identified:**

No similar existing features were identified for reference. This spec focuses on fixing bugs in the existing location management system.

### Follow-up Questions

No follow-up questions were needed. All requirements were clearly defined in the initial round.

## Visual Assets

### Files Provided:

No visual assets provided.

### Visual Insights:

No visual assets provided for this spec.

## Requirements Summary

### Functional Requirements

**Scope:**
- Fix all three bugs (LOC-001, LOC-002, LOC-003) in one spec
- Use separate commits for each fix
- Focus on bug fixes only, defer new features

**LOC-001: Country Field Missing + Data Loss**
- Add country parameter to EventLocation.fromObject() method (line 45 in src/common/model/location.ts)
- Make country field available in model/entity
- Country field is optional
- Fix data loss when editing through UI
- Defer UI display decision to future work

**LOC-002: Hierarchy Validation**
- Implement validation rules where more general location information requires more specific information:
  - Name only: Valid
  - City requires address
  - State requires city AND address
  - Postal code requires state AND city AND address
- Implement validation on BOTH client-side (Vue components) and server-side (API endpoints)
- Show ALL validation errors at once on save attempt (not on blur)
- Highlight invalid fields in standard warning color
- Error messages should be clear and brief (e.g., "City requires Address to be filled in")

**LOC-003: Event Update 404 Error**
- Discover root cause during implementation
- Use Playwright MCP to reproduce the error first
- Check both frontend event creation/editing component AND backend API responses
- Look at both new location creation and editing existing locations
- Fix identified issue to prevent 404 errors

### Reusability Opportunities

No existing similar features identified for reuse. This spec works with the existing location management system.

### Scope Boundaries

**In Scope:**
- Fix LOC-001: Add country field to model/entity, fix data loss
- Fix LOC-002: Implement hierarchy validation rules on client and server
- Fix LOC-003: Discover and fix root cause of 404 error
- Unit tests for validation logic
- Integration tests for API validation
- Test data can be updated (no migration needed)

**Out of Scope:**
- Country field UI display (deferred)
- Location autocomplete from previously used venues (roadmap feature)
- Location validation and standardization (roadmap feature)
- Bulk location updates across events (roadmap feature)
- End-to-end Playwright tests for this spec
- Database migration for existing invalid data (all current data is test data)

### Technical Considerations

- EventLocation model in src/common/model/location.ts needs country parameter
- Validation logic needs to be implemented in both:
  - Client-side: Vue components for event creation/editing
  - Server-side: API endpoints for location operations
- Error display should use standard warning color for invalid fields
- Use Playwright MCP to reproduce LOC-003 before attempting fix
- Separate commits for each of the three bug fixes
- Testing strategy:
  - Unit tests for validation service layer logic
  - Integration tests for API validation endpoints
  - No e2e tests in this spec
