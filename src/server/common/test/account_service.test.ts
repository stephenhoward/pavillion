import { test, expect, expectTypeOf } from 'vitest';
import sinon from 'sinon';
import AccountService from '../service/accounts';
import { AccountEntity, AccountSecretsEntity } from '../entity/account';
import { Account } from '../../../common/model/account';

let accountEntityStub = sinon.stub(AccountEntity, 'findOne');
let findSecretStub = sinon.stub(AccountSecretsEntity, 'findByPk');

test( 'getAccountBy success', async () => {
    accountEntityStub.callsFake( async (args) => {
        return AccountEntity.build({email: 'testme', username: 'testme', id: '1234'});
    });
    
    expectTypeOf( await AccountService.getAccountByEmail('testme') ).exclude<undefined>().toEqualTypeOf<Account>();
    expectTypeOf( await AccountService.getAccountById('1234') ).exclude<undefined>().toEqualTypeOf<Account>();
});

test( 'getAccountBy failure', async () => {
    accountEntityStub.callsFake( async () => {
        return null;
    });

    expect( await AccountService.getAccountByEmail('testme') ).toBe(undefined);
    expect( await AccountService.getAccountById('1234') ).toBe(undefined);
});

test( 'setPassword missing secret', async () => {

    let account = new Account('1234', 'testme', 'testme');

    findSecretStub.callsFake( async (args) => {  return null;  });

    expect( await AccountService.setPassword(account, 'newPassword') ).toBe(false);
});
