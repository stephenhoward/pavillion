# Category CRUD Investigation Findings

## Date: 2025-11-09

## Summary
Category management UPDATE and DELETE operations fail with 404 errors due to a mismatch between frontend API calls and backend route definitions.

## Testing Results

### ✅ CREATE - Working
- **Operation**: Add new category
- **Frontend URL**: `POST /api/v1/calendars/{calendarId}/categories`
- **Backend Route**: ✓ Exists (line 26 in categories.ts)
- **Status**: 201 Created
- **Result**: Successfully creates categories

### ✅ READ - Working
- **Operation**: List all categories
- **Frontend URL**: `GET /api/v1/calendars/{calendarId}/categories`
- **Backend Route**: ✓ Exists (line 25 in categories.ts)
- **Status**: 200 OK
- **Result**: Successfully retrieves category list

### ❌ UPDATE - Failing
- **Operation**: Edit category name
- **Frontend URL**: `PUT /api/v1/calendars/{calendarId}/categories/{categoryId}`
- **Backend Route**: ✗ Does not exist
- **Status**: 404 Not Found
- **Error**: "Error updating category: UnknownError: Unknown error occurred"
- **Console Error**: "Failed to load resource: the server responded with a status of 404"

### ❌ DELETE - Failing
- **Operation**: Delete category
- **Frontend URL**: `DELETE /api/v1/calendars/{calendarId}/categories/{categoryId}`
- **Backend Route**: ✗ Does not exist
- **Status**: 404 Not Found
- **Error**: "Failed to delete category"
- **Console Error**: "Failed to load resource: the server responded with a status of 404"

## Root Cause Analysis

### Backend Routes (src/server/calendar/api/v1/categories.ts)

The backend defines two sets of routes:

**Calendar-scoped routes (lines 24-26):**
```typescript
router.get('/calendars/:calendarId/categories', this.getCategories.bind(this));
router.post('/calendars/:calendarId/categories', this.createCategory.bind(this));
// ⚠️ Missing PUT and DELETE with calendar scope
```

**Backward-compatible routes (lines 28-31):**
```typescript
router.get('/categories/:categoryId', this.getCategoryById.bind(this));
router.put('/categories/:categoryId', this.updateCategoryById.bind(this));     // ✓ Exists
router.delete('/categories/:categoryId', this.deleteCategoryById.bind(this));   // ✓ Exists
```

### Frontend Implementation (src/client/service/category.ts)

**saveCategory() - Lines 74-105:**
```typescript
const url = `/api/v1/calendars/${encodedCalendarId}/categories`;

if (isNew) {
  // CREATE: POST /api/v1/calendars/{calendarId}/categories
  const responseData = await ModelService.createModel(category, url);
} else {
  // UPDATE: PUT /api/v1/calendars/{calendarId}/categories/{categoryId}
  const responseData = await ModelService.updateModel(category, url);
}
```

**deleteCategory() - Lines 132-145:**
```typescript
await axios.delete(`/api/v1/calendars/${encodedCalendarId}/categories/${encodedCategoryId}`);
```

### ModelService Pattern (src/client/service/models.ts)

**updateModel() - Line 62:**
```typescript
let response = await axios.put( url + '/' + model.id, model.toObject() );
```

This appends the model ID to the base URL, constructing:
`/api/v1/calendars/{calendarId}/categories/{categoryId}`

## The Mismatch

| Operation | Frontend Calls | Backend Has | Works? |
|-----------|---------------|-------------|--------|
| CREATE | `POST /api/v1/calendars/:calendarId/categories` | ✓ | ✅ Yes |
| READ | `GET /api/v1/calendars/:calendarId/categories` | ✓ | ✅ Yes |
| UPDATE | `PUT /api/v1/calendars/:calendarId/categories/:categoryId` | ✗ | ❌ No |
| DELETE | `DELETE /api/v1/calendars/:calendarId/categories/:categoryId` | ✗ | ❌ No |

The backend has UPDATE and DELETE at `/api/v1/categories/:categoryId` (backward-compatible), but the frontend expects them at `/api/v1/calendars/:calendarId/categories/:categoryId` (calendar-scoped).

## Solution Options

### Option 1: Add Calendar-Scoped Routes to Backend (Recommended)
**Approach**: Add the missing calendar-scoped routes to the backend

**Pros:**
- Maintains frontend expectations and patterns
- More RESTful - explicit resource hierarchy
- Consistent with CREATE/READ operations
- No frontend changes needed

**Cons:**
- Duplicate route handlers (calendar-scoped + backward-compatible)
- Slightly more backend code

**Implementation:**
```typescript
// Add to src/server/calendar/api/v1/categories.ts (lines ~26-27)
router.put('/calendars/:calendarId/categories/:categoryId', ExpressHelper.loggedInOnly, this.updateCategory.bind(this));
router.delete('/calendars/:calendarId/categories/:categoryId', ExpressHelper.loggedInOnly, this.deleteCategory.bind(this));
```

### Option 2: Update Frontend to Use Backward-Compatible Routes
**Approach**: Change frontend to call `/api/v1/categories/:categoryId` for UPDATE/DELETE

**Pros:**
- Uses existing backend routes
- Simpler route structure
- No backend changes needed

**Cons:**
- Inconsistent with CREATE/READ patterns
- Requires frontend changes across multiple files
- Less RESTful design
- May confuse future developers (mixed patterns)

**Implementation:**
Update CategoryService.saveCategory() and deleteCategory() to use simpler URLs

### Option 3: Refactor Both to Standardize
**Approach**: Decide on one pattern and update both frontend and backend

**Pros:**
- Complete consistency
- Clean architecture

**Cons:**
- Most work required
- Breaking changes to API

## Recommended Solution

**Option 1: Add calendar-scoped routes to backend**

This is the best solution because:
1. No breaking changes for frontend
2. Maintains RESTful hierarchy
3. Consistent with existing CREATE/READ patterns
4. Backward-compatible routes remain for any external API consumers

## Implementation Plan

1. Add calendar-scoped UPDATE route handler to backend
2. Add calendar-scoped DELETE route handler to backend
3. Ensure permission checks work with calendar context
4. Test all CRUD operations
5. Keep backward-compatible routes for API compatibility

## Screenshots

- **Update Error**: `planning/visuals/update-error.png`
- **Delete Error**: `planning/visuals/delete-error.png`

## Network Trace

```
[POST] /api/v1/calendars/c71f5c9e-7a3d-4e5f-8e1a-66c3612a05f3/categories => [201] Created ✓
[GET] /api/v1/calendars/c71f5c9e-7a3d-4e5f-8e1a-66c3612a05f3/categories => [200] OK ✓
[PUT] /api/v1/calendars/c71f5c9e-7a3d-4e5f-8e1a-66c3612a05f3/categories/d874f1ed-ac8d-416d-bff0-77816292faad => [404] Not Found ✗
[DELETE] /api/v1/calendars/c71f5c9e-7a3d-4e5f-8e1a-66c3612a05f3/categories/d874f1ed-ac8d-416d-bff0-77816292faad => [404] Not Found ✗
```
