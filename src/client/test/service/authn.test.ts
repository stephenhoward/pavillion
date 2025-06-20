import { describe, it, expect, afterEach } from 'vitest';
import sinon from 'sinon';
import axios from 'axios';

import AuthenticationService from '@/client/service/authn';

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

// Global setup for each test
afterEach(() => {
  sandbox.restore();
});

// async function test_basic_axios_roundtrip(stubbed_axios_method: sinon.SinonStub,auth_method: string,params: string[]) {

//     let authentication = new AuthenticationService( new LocalStore() );
//     let sandbox = sinon.createSandbox();
//     stubbed_axios_method.returns(Promise.resolve({status: 200, statusText: "Ok"}));

//     await expect( () => authentication[auth_method]() ).rejects.toThrowError();
//     await expect( () => authentication[auth_method]('') ).rejects.toThrowError();
//     return await authentication[auth_method](...params);
// }

describe('Login', () => {
  it( 'login fail', async () => {

    let authentication = new AuthenticationService( new LocalStore() );
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

    let authentication = new AuthenticationService( new LocalStore() );

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

    let authentication = new AuthenticationService( new LocalStore() );
    let stub1 = sinon.stub(authentication,"_unset_token");

    authentication.logout();

    expect(stub1.called).toBe(true);
  });
  it ('is_logged_in', () => {
    let store = new LocalStore();
    let authentication = new AuthenticationService( store );

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

//     let authentication = new AuthenticationService( new LocalStore() );


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

    let authentication = new AuthenticationService( new LocalStore() );
    let stub1 = sinon.stub(authentication,"_refresh_login");

    authentication._set_token(fake_jwt);

    let stored_jwt = authentication.jwt();

    expect( fake_jwt ).toEqual( stored_jwt );
    expect(stub1.calledOnce).toBe(true);;
  });

  it( '_unset_token', () => {

    let authentication = new AuthenticationService( new LocalStore() );
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
});

describe('Token Refresh', () => {
  it ( '_refresh_login 0 timer', () => {

    let authentication = new AuthenticationService( new LocalStore() );

    let stub1 = sandbox.stub(authentication,"_unset_token");

    authentication._refresh_login(0);

    expect( stub1.calledOnce ).toBe(true);
  });

  it ( '_refresh_login valid', async () => {

    let authentication = new AuthenticationService( new LocalStore() );
    sandbox.useFakeTimers();

    let stub1 = sandbox.stub(authentication,"_set_token");
    const axios_get = sandbox.stub(axios, "get");

    axios_get.returns(Promise.resolve({status: 200, statusText: "Ok", data: fake_jwt}));

    let promise = authentication._refresh_login( Date.now() + 500)
      .then( () => {
        expect( stub1.notCalled ).toBeFalsy;
      });
    sandbox.clock.runAll();

    return promise;
  });

});
