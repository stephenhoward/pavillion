import { describe, it, expect, expectTypeOf } from 'vitest';
import sinon from 'sinon';

import { Account } from '@/common/model/account';
import { AccountEntity, AccountSecretsEntity, AccountRoleEntity } from '@/server/common/entity/account';
import AccountService from '@/server/common/service/accounts';

let accountEntityStub = sinon.stub(AccountEntity, 'findOne');
let accountRoleEntityStub = sinon.stub(AccountRoleEntity, 'findAll');

describe('loading account roles', () => {
  it( 'loadAccountRoles empty', async () => {
    accountRoleEntityStub.callsFake( async() => {return [];} );

    let account = new Account('1234', 'testme', 'testme');
    account = await AccountService.loadAccountRoles(account);
    expect(account.roles?.length).toBe(0);
  });

  it( 'loadAccountRoles with roles', async () => {
    accountRoleEntityStub.callsFake( async() => {return [AccountRoleEntity.build({role: 'admin'})];} );

    let account = new Account('1234', 'testme', 'testme');
    account = await AccountService.loadAccountRoles(account);
    expect(account.roles?.length).toBe(1);
  });
});

describe('Account Retrieval', () => {
  it( 'getAccountBy success', async () => {
    accountEntityStub.callsFake( async () => {
      return AccountEntity.build({email: 'testme', username: 'testme', id: '1234'});
    });
    accountRoleEntityStub.callsFake( async() => {return [];} );

    expectTypeOf( await AccountService.getAccountByEmail('testme') ).exclude<undefined>().toEqualTypeOf<Account>();
    expectTypeOf( await AccountService.getAccountById('1234') ).exclude<undefined>().toEqualTypeOf<Account>();
  });

  it( 'getAccountBy failure', async () => {
    accountEntityStub.callsFake( async () => {
      return null;
    });

    expect( await AccountService.getAccountByEmail('testme') ).toBe(undefined);
    expect( await AccountService.getAccountById('1234') ).toBe(undefined);
  });
});

describe('Password Resets', () => {
  it( 'setPassword missing secret', async () => {
    let findSecretStub = sinon.stub(AccountSecretsEntity, 'findByPk');
    let account = new Account('1234', 'testme', 'testme');

    findSecretStub.callsFake( async () => {  return null;  });

    expect( await AccountService.setPassword(account, 'newPassword') ).toBe(false);
  });
});
