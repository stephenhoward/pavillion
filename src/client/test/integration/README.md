# Client-Server Integration Tests

This directory contains integration tests that verify the client and server API contracts remain in sync.

## Test Structure

Each test file covers a specific API domain:

- `authentication.test.ts` - Authentication endpoints
- `accounts.test.ts` - Account management endpoints  
- `calendars.test.ts` - Calendar and event endpoints
- `configuration.test.ts` - Site configuration endpoints
- `activitypub.test.ts` - ActivityPub federation endpoints

## Test Strategy

These tests:
1. Start a real server instance
2. Make actual HTTP requests using the same client service classes
3. Verify that endpoints exist and return expected status codes
4. Validate response structure matches client expectations
5. Test authentication/authorization requirements

## Running Tests

```bash
npm run test:integration:client
```

## Adding New Tests

When adding new API endpoints:
1. Add the endpoint to the appropriate test file
2. Test both success and error cases
3. Verify authentication requirements
4. Test request/response data structures
