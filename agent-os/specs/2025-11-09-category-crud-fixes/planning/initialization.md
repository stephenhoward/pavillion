# Category CRUD Interface Issues - Initial Investigation

## Spec Idea
The category management interface has issues with CRUD operations - errors occur when trying to update, delete, and perform other operations on categories. Need to test all category operations in browser and check console for errors.

## Initial Code Analysis

### Frontend Service Issue Identified
**File:** `/src/client/service/category.ts`

The frontend CategoryService is calling incorrect API endpoints for UPDATE and DELETE operations:

**UPDATE (lines 94-96):**
```typescript
// Update existing category
const responseData = await ModelService.updateModel(category, url);
// Where url = `/api/v1/calendars/${encodedCalendarId}/categories`
```

**DELETE (line 137):**
```typescript
await axios.delete(`/api/v1/calendars/${encodedCalendarId}/categories/${encodedCategoryId}`);
```

### Backend API Routes Available
**File:** `/src/server/calendar/api/v1/categories.ts`

The backend defines these routes:
- `GET /calendars/:calendarId/categories` (line 25) - LIST categories
- `POST /calendars/:calendarId/categories` (line 26) - CREATE category
- `GET /categories/:categoryId` (line 29) - READ single category
- `PUT /categories/:categoryId` (line 30) - UPDATE category ✅
- `DELETE /categories/:categoryId` (line 31) - DELETE category ✅
- `GET /categories/:categoryId/events` (line 32) - Get events for category

### Root Cause
**Frontend is calling routes that don't exist:**
1. ❌ `PUT /api/v1/calendars/:calendarId/categories` - NOT DEFINED
2. ❌ `DELETE /api/v1/calendars/:calendarId/categories/:categoryId` - NOT DEFINED

**Backend provides backward-compatible routes:**
1. ✅ `PUT /api/v1/categories/:categoryId` - EXISTS
2. ✅ `DELETE /api/v1/categories/:categoryId` - EXISTS

### Expected Errors
When users try to:
- **UPDATE a category:** 404 Not Found (route doesn't exist)
- **DELETE a category:** 404 Not Found (route doesn't exist)

## Browser Testing Plan
1. Navigate to category management interface
2. Test CREATE operation (should work)
3. Test UPDATE operation (expected to fail with 404)
4. Test DELETE operation (expected to fail with 404)
5. Capture console errors and network requests
6. Document exact error messages shown to users

## Status
- Code analysis: COMPLETE
- Browser testing: PENDING
- Requirements gathering: PENDING
