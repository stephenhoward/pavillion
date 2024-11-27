import { describe, it, expect, expectTypeOf } from 'vitest';
import sinon from 'sinon';
import AccountService from '../service/accounts';
import { AccountEntity, AccountSecretsEntity, AccountRoleEntity } from '../entity/account';
import { Account } from '../../../common/model/account';

let accountEntityStub = sinon.stub(AccountEntity, 'findOne');
let accountRoleEntityStub = sinon.stub(AccountRoleEntity, 'findAll');

describe('loading account roles', () => {
    it( 'loadAccountRoles empty', async () => {
        accountRoleEntityStub.callsFake( async(args) => {return []} );

        let account = new Account('1234', 'testme', 'testme');
        account = await AccountService.loadAccountRoles(account);
        expect(account.roles?.length).toBe(0);
    });

    it( 'loadAccountRoles with roles', async () => {
        accountRoleEntityStub.callsFake( async(args) => {return [{role: 'admin'}]} );

        let account = new Account('1234', 'testme', 'testme');
        account = await AccountService.loadAccountRoles(account);
        expect(account.roles?.length).toBe(1);
    });
});

describe('Account Retrieval', () => {
    it( 'getAccountBy success', async () => {
        accountEntityStub.callsFake( async (args) => {
            return AccountEntity.build({email: 'testme', username: 'testme', id: '1234'});
        });
        accountRoleEntityStub.callsFake( async(args) => {return []} );

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
        let saveSecretStub = sinon.stub(AccountSecretsEntity.prototype, 'save');
        let account = new Account('1234', 'testme', 'testme');

        findSecretStub.callsFake( async (args) => {  return null;  });

        expect( await AccountService.setPassword(account, 'newPassword') ).toBe(false);
    });
});
