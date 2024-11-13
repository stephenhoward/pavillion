import { test, expect, expectTypeOf } from 'vitest';
import sinon from 'sinon';
import AccountService from '../service/account';
import { AccountEntity, AccountSecretsEntity } from '../entity/account';
import { Account } from '../model/account';

let accountEntityStub = sinon.stub(AccountEntity, 'findOne');
let findSecretStub = sinon.stub(AccountSecretsEntity, 'findByPk');

test( 'getAccountBy success', async () => {
    accountEntityStub.callsFake( async (args) => {
        return AccountEntity.build({email: 'testme', username: 'testme', id: '1234'});
    });
    
    expectTypeOf( typeof await AccountService.getAccountByEmail('testme') ).exclude<null>().toEqualTypeOf<Account>();
    expectTypeOf( typeof await AccountService.getAccountById('1234') ).exclude<null>().toEqualTypeOf<Account>();
});

test( 'getAccountBy failure', async () => {
    accountEntityStub.callsFake( async () => {
        return null;
    });

    expect( await AccountService.getAccountByEmail('testme') ).toBe(undefined);
    expect( await AccountService.getAccountById('1234') ).toBe(undefined);
});

test( 'checkPassword', async () => {

    let account = new Account('1234', 'testme', 'testme');
    let secrets = AccountSecretsEntity.build({
        account_id: '1234',
    });
    let saveSecretStub = sinon.stub(secrets, 'save');


    findSecretStub.callsFake( async (args) => {  return secrets;  });

    expect( await AccountService.setPassword(account, 'newPassword') ).toBe(true);
    expect( secrets.password ).not.toBe('testme');
    expect( secrets.password ).not.toBe('newPassword');
    expect( secrets.salt ).not.toBe('testme');
    expect( await AccountService.checkPassword(new Account(), 'testme') ).toBe(false);
    expect( await AccountService.checkPassword(new Account(), 'newPassword') ).toBe(true);
});

test( 'setPassword missing secret', async () => {

    let account = new Account('1234', 'testme', 'testme');

    findSecretStub.callsFake( async (args) => {  return null;  });

    expect( await AccountService.setPassword(account, 'newPassword') ).toBe(false);
});

test('registerNewAccount', async () => {
});
