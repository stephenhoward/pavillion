import { describe, it, expect, afterEach } from 'vitest';
import sinon from 'sinon';
import axios from 'axios';

import AuthenticationService from '@/client/service/authn';
import { SessionExpiredError } from '@/common/exceptions/authentication';
import { EmptyValueError } from '@/common/exceptions/base';

class LocalStore implements Storage {

  declare store: { [key: string]: string };;

  get length(): number {
    return Object.keys(this.store).length;
  }

  key(index: number): string | null {
    const keys = Object.keys(this.store);
    return keys[index] || null;
  }

  constructor() {
    this.store = {};
  }

  getItem(key: string) {
    return this.store[key];
  }

  setItem(key: string,value: any) {
    this.store[key] = value.toString();
  }

  removeItem(key: string) {
    delete this.store[key];
  }

  clear() {
    this.store = {};
  }
}

const sandbox = sinon.createSandbox();
let fake_jwt = '1234.'+btoa('{ "exp": "1000"}');

// Track AuthenticationService instances created per test so we can eject
// their axios interceptors in afterEach. Without this, every test leaves
// request + response interceptors registered on the global axios, causing
// subtle cross-test interference as stacks accumulate.
const createdServices: AuthenticationService[] = [];

function makeAuth(): AuthenticationService {
  const svc = new AuthenticationService( new LocalStore() );
  createdServices.push(svc);
  return svc;
}

// Global setup for each test
afterEach(() => {
  sandbox.restore();
  for (const s of createdServices) {
    axios.interceptors.request.eject(s._requestInterceptorId);
    axios.interceptors.response.eject(s._responseInterceptorId);
  }
  createdServices.length = 0;
});

// async function test_basic_axios_roundtrip(stubbed_axios_method: sinon.SinonStub,auth_method: string,params: string[]) {

//     let authentication = makeAuth();
//     let sandbox = sinon.createSandbox();
//     stubbed_axios_method.returns(Promise.resolve({status: 200, statusText: "Ok"}));

//     await expect( () => authentication[auth_method]() ).rejects.toThrowError();
//     await expect( () => authentication[auth_method]('') ).rejects.toThrowError();
//     return await authentication[auth_method](...params);
// }

describe('Login', () => {
  it( 'login fail', async () => {

    let authentication = makeAuth();
    let stub1 = sandbox.stub(authentication,"_unset_token");
    let stub2 = sandbox.stub(authentication,"_set_token");
    const axios_post = sandbox.stub(axios, "post");
    axios_post.returns(Promise.reject({status: 400, data: {}}));

    try {
      await authentication.login('user','password');
    }
    catch {
      expect(stub1.called).toBe(true);
      expect(stub2.notCalled).toBe(true);
    };

  });

  it( 'login succeed', async () => {

    let authentication = makeAuth();

    let stub1 = sandbox.stub(authentication,"_unset_token");
    let stub2 = sandbox.stub(authentication,"_set_token");
    const axios_post = sandbox.stub(axios, "post");
    axios_post.returns(Promise.resolve({status: 200, data: {}}));

    await authentication.login('user','password');

    expect(stub1.called).toBe(false);
    expect(stub2.called).toBe(true);
  });
});
describe('Logout', () => {
  it( 'logout', () => {

    let authentication = makeAuth();
    let stub1 = sinon.stub(authentication,"_unset_token");

    authentication.logout();

    expect(stub1.called).toBe(true);
  });
  it ('is_logged_in', () => {
    let authentication = makeAuth();

    expect( authentication.isLoggedIn() ).toBe(false);
    let stub1 = sinon.stub(authentication,"_refresh_login");

    authentication._set_token(fake_jwt);

    expect( authentication.isLoggedIn() ).toBe(false);

    let good_jwt = '1234.'+btoa('{ "exp": "'+(Date.now()+500)+'"}');
    authentication._set_token(good_jwt);

    expect( authentication.isLoggedIn() ).toBe(true);
    expect(stub1.called).toBe(true);

  });
});

// test( 'reset_password', async () => {

//     let authentication = makeAuth();


//     await test_basic_axios_roundtrip(axios_post,'reset_password',['email']);
// });

// test( 'check_password_reset_token', async () => {

//     await test_basic_axios_roundtrip(axios_get,'check_password_reset_token',['token']);
// });

// test( 'use_password_reset_token', async () => {

//     await test_basic_axios_roundtrip(axios_post,'use_password_reset_token',['token','password']);
// });

describe('Token Setting', () => {
  it( '_set_token', () => {

    let authentication = makeAuth();
    let stub1 = sinon.stub(authentication,"_refresh_login");

    authentication._set_token(fake_jwt);

    let stored_jwt = authentication.jwt();

    expect( fake_jwt ).toEqual( stored_jwt );
    expect(stub1.calledOnce).toBe(true);;
  });

  it( '_unset_token', () => {

    let authentication = makeAuth();
    sandbox.stub(authentication,"_refresh_login");

    authentication._set_token(fake_jwt);
    authentication._refresh_timer = setTimeout( () => {}, 1000 );

    expect( authentication.localStore.getItem('jwt') ).toBeTruthy();
    expect( authentication.localStore.getItem('jw_token') ).toBeTruthy();
    expect( authentication._refresh_timer ).toBeTruthy();

    authentication._unset_token();

    expect( authentication.localStore.getItem('jwt') ).toBeFalsy();
    expect( authentication.localStore.getItem('jw_token') ).toBeFalsy();
    expect( authentication._refresh_timer ).toBeFalsy();

  });

  it('_unset_token clears lastKnownEmail', () => {
    let authentication = makeAuth();
    authentication.lastKnownEmail = 'user@example.com';

    authentication._unset_token();

    expect(authentication.lastKnownEmail).toBeNull();
  });
});

describe('Invitation Management', () => {
  it('revoke_invitation calls DELETE on the invitation endpoint', async () => {
    let authentication = makeAuth();
    const axios_delete = sandbox.stub(axios, 'delete');
    axios_delete.resolves({ status: 200, data: { success: true } });

    const result = await authentication.revoke_invitation('inv-123');

    expect(axios_delete.calledOnce).toBe(true);
    expect(axios_delete.firstCall.args[0]).toBe('/api/v1/invitations/inv-123');
    expect(result).toEqual({ success: true });
  });

  it('revoke_invitation throws response status on error', async () => {
    let authentication = makeAuth();
    const axios_delete = sandbox.stub(axios, 'delete');
    const error = new axios.AxiosError('Not found', '404', undefined, undefined, {
      status: 404,
      data: { error: 'Not found' },
      statusText: 'Not Found',
      headers: {},
      config: {} as any,
    } as any);
    axios_delete.rejects(error);

    await expect(authentication.revoke_invitation('inv-123')).rejects.toThrow('Request failed with status 404');
  });
});

describe('Token Refresh', () => {
  it ( '_refresh_login 0 timer', () => {

    let authentication = makeAuth();

    let stub1 = sandbox.stub(authentication,"_unset_token");

    authentication._refresh_login(0);

    expect( stub1.calledOnce ).toBe(true);
  });

  it ( '_refresh_login valid', async () => {

    let authentication = makeAuth();
    sandbox.useFakeTimers();
    // Seed a jwt so _refresh_login's jwt() guard passes and it actually
    // fetches + stores a fresh token — without this the success path is
    // never exercised and the assertion below passes trivially.
    authentication.localStore.setItem('jwt', fake_jwt);

    let stub1 = sandbox.stub(authentication,"_set_token");
    const axios_get = sandbox.stub(axios, "get");

    axios_get.returns(Promise.resolve({status: 200, statusText: "Ok", data: fake_jwt}));

    let promise = authentication._refresh_login( Date.now() + 500)
      .then( () => {
        expect( stub1.calledOnceWith(fake_jwt) ).toBe(true);
      });
    sandbox.clock.runAll();

    return promise;
  });

  it('_refresh_login failure flips sessionExpired', async () => {
    let authentication = makeAuth();
    sandbox.useFakeTimers();
    // Ensure _refresh_login's jwt() check returns something so it attempts the call
    authentication.localStore.setItem('jwt', fake_jwt);

    sandbox.stub(axios, 'get').rejects(new Error('network down'));

    let promise = authentication._refresh_login( Date.now() + 500 )
      .then(
        () => { throw new Error('should have rejected'); },
        () => {
          expect(authentication.sessionExpired.value).toBe(true);
        },
      );
    sandbox.clock.runAll();
    return promise;
  });

});

describe('Session-Expired Interceptor', () => {
  // Capture the rejection handler each AuthenticationService registers, so we
  // can invoke it directly without relying on real axios network flow.
  function captureResponseErrorHandler(): {
    authentication: AuthenticationService;
    onError: (error: any) => any;
  } {
    const useSpy = sandbox.spy(axios.interceptors.response, 'use');
    const authentication = makeAuth();
    // The response interceptor is the one registered during this constructor.
    // The constructor only registers one response interceptor.
    const lastCall = useSpy.lastCall;
    const onError = lastCall.args[1] as (error: any) => any;
    return { authentication, onError };
  }

  it('401 on an authenticated endpoint queues the request and flips the flag', async () => {
    const { authentication, onError } = captureResponseErrorHandler();
    expect(authentication.sessionExpired.value).toBe(false);

    const error = {
      response: { status: 401 },
      config: { url: '/api/v1/events', method: 'get' },
    };

    // The returned promise is intentionally left pending until drain/abort.
    const pending = onError(error);
    expect(pending).toBeInstanceOf(Promise);
    expect(authentication._pendingRequests.length).toBe(1);
    expect(authentication.sessionExpired.value).toBe(true);

    // Settle the pending promise so vitest doesn't warn about unhandled state.
    authentication.abortPendingRequests();
    await expect(pending).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it('401 on /api/auth/* passes through without touching the flag', async () => {
    const { authentication, onError } = captureResponseErrorHandler();

    const error = {
      response: { status: 401 },
      config: { url: '/api/auth/v1/login', method: 'post' },
    };

    await expect(onError(error)).rejects.toBe(error);
    expect(authentication._pendingRequests.length).toBe(0);
    expect(authentication.sessionExpired.value).toBe(false);
  });

  it('403 passes through without touching the flag', async () => {
    const { authentication, onError } = captureResponseErrorHandler();

    const error = {
      response: { status: 403 },
      config: { url: '/api/v1/events', method: 'get' },
    };

    await expect(onError(error)).rejects.toBe(error);
    expect(authentication._pendingRequests.length).toBe(0);
    expect(authentication.sessionExpired.value).toBe(false);
  });

  it('parallel 401s flip the flag once and enqueue many entries', () => {
    const { authentication, onError } = captureResponseErrorHandler();

    const pendings: Promise<any>[] = [];
    for (let i = 0; i < 5; i++) {
      pendings.push(
        onError({
          response: { status: 401 },
          config: { url: `/api/v1/resource/${i}`, method: 'get' },
        }),
      );
    }

    expect(authentication._pendingRequests.length).toBe(5);
    expect(authentication.sessionExpired.value).toBe(true);

    authentication.abortPendingRequests();
    return Promise.all(pendings.map((p) => p.catch((e) => e))).then((results) => {
      results.forEach((r) => expect(r).toBeInstanceOf(SessionExpiredError));
    });
  });

  it('drainPendingRequests replays queued requests and resolves originals', async () => {
    const { authentication, onError } = captureResponseErrorHandler();

    const request_stub = sandbox.stub(axios, 'request');
    request_stub.onFirstCall().resolves({ status: 200, data: 'first' });
    request_stub.onSecondCall().resolves({ status: 200, data: 'second' });

    const p1 = onError({
      response: { status: 401 },
      config: { url: '/api/v1/first', method: 'get' },
    });
    const p2 = onError({
      response: { status: 401 },
      config: { url: '/api/v1/second', method: 'post', data: { x: 1 } },
    });

    expect(authentication.sessionExpired.value).toBe(true);

    await authentication.drainPendingRequests();

    await expect(p1).resolves.toMatchObject({ status: 200, data: 'first' });
    await expect(p2).resolves.toMatchObject({ status: 200, data: 'second' });
    expect(request_stub.callCount).toBe(2);
    expect(request_stub.firstCall.args[0]).toMatchObject({ url: '/api/v1/first' });
    expect(request_stub.secondCall.args[0]).toMatchObject({ url: '/api/v1/second' });
    expect(authentication.sessionExpired.value).toBe(false);
    expect(authentication._pendingRequests.length).toBe(0);
  });

  it('drainPendingRequests rejects originals when a replay fails', async () => {
    const { authentication, onError } = captureResponseErrorHandler();

    const request_stub = sandbox.stub(axios, 'request');
    const retryError = { response: { status: 500 }, message: 'server exploded' };
    request_stub.rejects(retryError);

    const p1 = onError({
      response: { status: 401 },
      config: { url: '/api/v1/drain-fail', method: 'get' },
    });

    expect(authentication.sessionExpired.value).toBe(true);

    await authentication.drainPendingRequests();

    await expect(p1).rejects.toBe(retryError);
    expect(authentication.sessionExpired.value).toBe(false);
    expect(authentication._pendingRequests.length).toBe(0);
  });

  it('abortPendingRequests rejects queued requests with SessionExpiredError', async () => {
    const { authentication, onError } = captureResponseErrorHandler();

    const p1 = onError({
      response: { status: 401 },
      config: { url: '/api/v1/a', method: 'get' },
    });
    const p2 = onError({
      response: { status: 401 },
      config: { url: '/api/v1/b', method: 'get' },
    });

    authentication.abortPendingRequests();

    await expect(p1).rejects.toBeInstanceOf(SessionExpiredError);
    await expect(p2).rejects.toBeInstanceOf(SessionExpiredError);
    expect(authentication.sessionExpired.value).toBe(false);
    expect(authentication._pendingRequests.length).toBe(0);
  });
});

describe('lastKnownEmail', () => {
  it('is populated by a successful login', async () => {
    let authentication = makeAuth();
    sandbox.stub(authentication, '_set_token');
    sandbox.stub(axios, 'post').resolves({ status: 200, data: {} });

    expect(authentication.lastKnownEmail).toBeNull();
    await authentication.login('person@example.com', 'pw');
    expect(authentication.lastKnownEmail).toBe('person@example.com');
  });

  it('is not populated by a failed login', async () => {
    let authentication = makeAuth();
    sandbox.stub(authentication, '_unset_token');
    sandbox.stub(axios, 'post').rejects({ status: 400, data: {} });

    await authentication.login('person@example.com', 'pw');
    expect(authentication.lastKnownEmail).toBeNull();
  });
});

describe('changeEmail (initiate)', () => {
  it('posts to /email and returns true on a 200, without refreshing the session', async () => {
    let authentication = makeAuth();
    const refresh = sandbox.stub(authentication, '_refresh_login');
    const axios_post = sandbox.stub(axios, 'post');
    axios_post.resolves({ status: 200, data: { success: true } });

    const result = await authentication.changeEmail('new@example.com', 'pw');

    expect(result).toBe(true);
    expect(axios_post.calledOnceWith('/api/auth/v1/email', { email: 'new@example.com', password: 'pw' })).toBe(true);
    // The address is not changed yet — no session refresh should occur.
    expect(refresh.called).toBe(false);
  });

  it('returns false when the initiate request fails', async () => {
    let authentication = makeAuth();
    sandbox.stub(authentication, '_refresh_login');
    sandbox.stub(axios, 'post').rejects({ response: { status: 401 } });

    const result = await authentication.changeEmail('new@example.com', 'pw');

    expect(result).toBe(false);
  });
});

describe('confirmEmailChange', () => {
  it('posts the token as a path param and returns valid:true on success', async () => {
    let authentication = makeAuth();
    const token = 'a'.repeat(32);
    const axios_post = sandbox.stub(axios, 'post');
    axios_post.resolves({ status: 200, data: { success: true } });

    const result = await authentication.confirmEmailChange(token);

    expect(result).toEqual({ valid: true });
    expect(axios_post.calledOnceWith('/api/auth/v1/email/confirm/' + token)).toBe(true);
  });

  it('returns valid:false when the backend collapses to {valid:false}', async () => {
    let authentication = makeAuth();
    sandbox.stub(axios, 'post').resolves({ status: 200, data: { valid: false } });

    const result = await authentication.confirmEmailChange('b'.repeat(32));

    expect(result).toEqual({ valid: false });
  });

  it('throws when given an empty token', async () => {
    let authentication = makeAuth();

    await expect(() => authentication.confirmEmailChange('')).rejects.toBeInstanceOf(EmptyValueError);
  });

  it('throws the HTTP status on a non-2xx response', async () => {
    let authentication = makeAuth();
    const error = new axios.AxiosError('Too Many Requests', '429', undefined, undefined, {
      status: 429,
      data: {},
      statusText: 'Too Many Requests',
      headers: {},
      config: {} as any,
    } as any);
    sandbox.stub(axios, 'post').rejects(error);

    await expect(authentication.confirmEmailChange('c'.repeat(32))).rejects.toThrow('Request failed with status 429');
  });
});

describe('refreshToken', () => {
  it('returns false without hitting the network when no session is present', async () => {
    let authentication = makeAuth();
    const axios_get = sandbox.stub(axios, 'get');

    const result = await authentication.refreshToken();

    expect(result).toBe(false);
    expect(axios_get.called).toBe(false);
  });

  it('fetches a fresh token and stores it when a session is present', async () => {
    let authentication = makeAuth();
    authentication.localStore.setItem('jwt', fake_jwt);
    const set_token = sandbox.stub(authentication, '_set_token');
    const axios_get = sandbox.stub(axios, 'get');
    axios_get.resolves({ status: 200, data: fake_jwt });

    const result = await authentication.refreshToken();

    expect(result).toBe(true);
    expect(axios_get.calledOnceWith('/api/auth/v1/token')).toBe(true);
    expect(set_token.calledOnceWith(fake_jwt)).toBe(true);
  });

  it('returns false (non-fatal) when the refresh request fails', async () => {
    let authentication = makeAuth();
    authentication.localStore.setItem('jwt', fake_jwt);
    sandbox.stub(authentication, '_set_token');
    sandbox.stub(axios, 'get').rejects({ response: { status: 401 } });

    const result = await authentication.refreshToken();

    expect(result).toBe(false);
  });
});
