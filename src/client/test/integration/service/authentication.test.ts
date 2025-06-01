/**
 * AuthenticationService Integration Tests
 *
 * Tests the client AuthenticationService against the server integration environment.
 * Uses Sinon for mocking instead of Vitest mocks for better compatibility.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import sinon from 'sinon';
import AuthenticationService from '@/client/service/authn';
import { setupIntegrationTests, cleanupIntegrationTests } from '../setup';

// Mock localStorage for testing
class MockLocalStorage implements Storage {
  private store: { [key: string]: string } = {};

  get length(): number {
    return Object.keys(this.store).length;
  }

  key(index: number): string | null {
    const keys = Object.keys(this.store);
    return keys[index] || null;
  }

  getItem(key: string): string | null {
    return this.store[key] || null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = value;
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  clear(): void {
    this.store = {};
  }
}

describe('AuthenticationService Integration Tests', () => {
  let testEnv: any;
  let authService: AuthenticationService;
  let mockLocalStorage: MockLocalStorage;
  let sandbox: sinon.SinonSandbox;

  beforeAll(async () => {
    testEnv = await setupIntegrationTests();
  });

  afterAll(async () => {
    await cleanupIntegrationTests();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockLocalStorage = new MockLocalStorage();
    authService = new AuthenticationService(mockLocalStorage);
  });

  afterEach(() => {
    authService.logout();
    sandbox.restore();
  });

//   it('should successfully authenticate with valid credentials', async () => {
//     // Create test user through testEnv
//     const testUser = await testEnv.createTestUser('testuser@example.com', 'testpassword');

//     // Test login
//     const loginResult = await authService.login('testuser@example.com', 'testpassword');

//     expect(loginResult).toBeTruthy();
//     expect(authService.isLoggedIn()).toBe(true);
//     expect(authService.userEmail()).toBe(testUser.email);
//   });

//   it('should initiate password reset for valid email', async () => {
//     const testUser = await testEnv.createTestUser('reset@example.com', 'oldpassword');

//     const resetResult = await authService.reset_password('reset@example.com');

//     expect(resetResult).toBeDefined();
//     expect(resetResult.message).toBe('ok');
//   });

//   it('should validate password reset tokens', async () => {
//     const testUser = await testEnv.createTestUser('tokentest@example.com', 'oldpassword');

//     // This test would require access to the generated token
//     // In a real scenario, you'd retrieve the token from the test environment
//     // For now, we'll test with an invalid token to verify rejection
//     const isValid = await authService.check_password_reset_token('invalid-token');

//     expect(isValid).toBe(false);
//   });

  it('should refresh authentication tokens before expiry', async () => {
    console.log('Starting token refresh test...');
    const testUser = await testEnv.createTestUser('refresh@example.com', 'testpassword');
    await authService.login('refresh@example.com', 'testpassword');

    const originalToken = authService.jwt();
    expect(originalToken).toBeTruthy();
    console.log('Original Token:', originalToken);

    // Manually trigger refresh (in real scenario this happens automatically)
    await authService._do_token_refresh();

    const newToken = authService.jwt();
    expect(newToken).toBeTruthy();
    expect(newToken).not.toEqual(originalToken);
  });
});

//     it('should handle token refresh failures by logging out', async () => {
//       const testUser = await testEnv.createTestUser('refreshfail@example.com', 'testpassword');
//       await authService.login('refreshfail@example.com', 'testpassword');

//       // Mock failed token refresh
//       const axiosStub = sandbox.stub(axios, 'get');
//       axiosStub.rejects(new Error('Token refresh failed'));

//       try {
//         await authService._refresh_login(Math.floor(Date.now() / 1000) + 300);
//       } catch (error) {
//         // Expected to throw
//       }

//       expect(authService.isLoggedIn()).toBe(false);
//     });
//   });

//   describe('Email Change', () => {
//     it('should change email with valid password', async () => {
//       const testUser = await testEnv.createTestUser('change@example.com', 'testpassword');
//       await authService.login('change@example.com', 'testpassword');

//       const changeResult = await authService.changeEmail('newemail@example.com', 'testpassword');

//       expect(changeResult).toBe(true);
//       // After email change, the new email should be reflected in the token
//       expect(authService.userEmail()).toBe('newemail@example.com');
//     });

//     it('should reject email change with invalid password', async () => {
//       const testUser = await testEnv.createTestUser('changefail@example.com', 'testpassword');
//       await authService.login('changefail@example.com', 'testpassword');

//       const changeResult = await authService.changeEmail('newemail@example.com', 'wrongpassword');

//       expect(changeResult).toBe(false);
//       expect(authService.userEmail()).toBe('changefail@example.com');
//     });
//   });

//   describe('Admin Permissions', () => {
//     it('should correctly identify admin users', async () => {
//       const adminUser = await testEnv.createAdminUser('admin@example.com', 'adminpassword');
//       await authService.login('admin@example.com', 'adminpassword');

//       expect(authService.isAdmin()).toBe(true);
//     });

//     it('should correctly identify non-admin users', async () => {
//       const regularUser = await testEnv.createTestUser('regular@example.com', 'testpassword');
//       await authService.login('regular@example.com', 'testpassword');

//       expect(authService.isAdmin()).toBe(false);
//     });
//   });

//   describe('HTTP Interceptors', () => {
//     it('should automatically add Authorization header to axios requests', async () => {
//       const testUser = await testEnv.createTestUser('headers@example.com', 'testpassword');
//       await authService.login('headers@example.com', 'testpassword');

//       // Mock axios request to verify headers
//       const axiosStub = sandbox.stub(axios, 'get');
//       axiosStub.resolves({ status: 200, data: {} });

//       await axios.get('/some-endpoint');

//       const request = axiosStub.getCall(0);
//       expect(request.args[1]?.headers?.Authorization).toMatch(/^Bearer /);
//     });

//     it('should not add Authorization header when not logged in', async () => {
//       // Mock axios request to verify no headers
//       const axiosStub = sandbox.stub(axios, 'get');
//       axiosStub.resolves({ status: 200, data: {} });

//       await axios.get('/some-endpoint');

//       const request = axiosStub.getCall(0);
//       expect(request.args[1]?.headers?.Authorization).toBeUndefined();
//     });
//   });

//   describe('Error Handling', () => {
//     it('should handle network errors gracefully in login', async () => {
//       const axiosStub = sandbox.stub(axios, 'post');
//       axiosStub.rejects(new Error('Network error'));

//       try {
//         await authService.login('test@example.com', 'password');
//         expect.fail('Should have thrown an error');
//       } catch (error) {
//         expect(error).toBeInstanceOf(Error);
//         expect(authService.isLoggedIn()).toBe(false);
//       }
//     });

//     it('should handle server errors during password reset', async () => {
//       const axiosStub = sandbox.stub(axios, 'post');
//       axiosStub.rejects({ response: { status: 500 } });

//       try {
//         await authService.reset_password('test@example.com');
//         expect.fail('Should have thrown an error');
//       } catch (error) {
//         expect(error.response.status).toBe(500);
//       }
//     });
//   });
// });
