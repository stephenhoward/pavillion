import { TestEnvironment } from '@/server/test/lib/test_environment';
import db from '@/server/common/entity/db';
import { Account } from '@/common/model/account';

/**
 * Base setup for client-server integration tests
 * Provides a real server instance and common utilities
 */
export class ClientServerTestEnvironment {
  public env: TestEnvironment;
  public adminAuthKey: string = '';
  public userAuthKey: string = '';

  constructor() {
    this.env = new TestEnvironment();
  }

  async setup() {
    await this.env.init();

    // // Create test admin user
    // await this.createTestUser('admin@test.com', 'adminpass', ['admin']);
    // this.adminAuthKey = await this.env.login('admin@test.com', 'adminpass');

    // // Create test regular user
    // await this.createTestUser('user@test.com', 'userpass', []);
    // this.userAuthKey = await this.env.login('user@test.com', 'userpass');
  }

  async cleanup() {
    // Clean up database
    await db.sync({ force: true });
  }

  public async createTestUser(email: string, password: string, roles: string[]): Promise<Account> {
    return this.env.createTestUser(email, password, roles);
  }

  /**
   * Make authenticated request as admin
   */
  async adminRequest(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, data?: any) {
    const request = require('supertest');
    const req = request(this.env.app)[method.toLowerCase()](url)
      .set('Authorization', 'Bearer ' + this.adminAuthKey);

    if (data) {
      req.send(data);
    }

    return req;
  }

  /**
   * Make authenticated request as regular user
   */
  async userRequest(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, data?: any) {
    const request = require('supertest');
    const req = request(this.env.app)[method.toLowerCase()](url)
      .set('Authorization', 'Bearer ' + this.userAuthKey);

    if (data) {
      req.send(data);
    }

    return req;
  }

  /**
   * Make unauthenticated request
   */
  async publicRequest(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, data?: any, headers?: any) {
    const request = require('supertest');
    const req = request(this.env.app)[method.toLowerCase()](url);

    if (headers) {
      Object.keys(headers).forEach(key => {
        req.set(key, headers[key]);
      });
    }

    if (data) {
      req.send(data);
    }

    return req;
  }
}

// Global test environment instance
let testEnv: ClientServerTestEnvironment;

export async function setupIntegrationTests() {
  testEnv = new ClientServerTestEnvironment();
  await testEnv.setup();
  return testEnv;
}

export async function cleanupIntegrationTests() {
  if (testEnv) {
    await testEnv.cleanup();
  }
}

export function getTestEnvironment(): ClientServerTestEnvironment {
  return testEnv;
}
