import { test, expect, expectTypeOf } from 'vitest';
import sinon from 'sinon';
import AccountService from '../service/account';
import CommonAccountService from '../../common/service/accounts';
import { AccountEntity, AccountSecretsEntity } from '../../common/entity/account';
import { Account } from '../../../common/model/account';

let accountEntityStub = sinon.stub(AccountEntity, 'findOne');
let findSecretStub = sinon.stub(AccountSecretsEntity, 'findByPk');

test( 'checkPassword', async () => {

    let account = new Account('1234', 'testme', 'testme');
    let secrets = AccountSecretsEntity.build({
        account_id: '1234',
    });
    let saveSecretStub = sinon.stub(secrets, 'save');


    findSecretStub.callsFake( async (args) => {  return secrets;  });

    expect( await CommonAccountService.setPassword(account, 'newPassword') ).toBe(true);
    expect( secrets.password ).not.toBe('testme');
    expect( secrets.password ).not.toBe('newPassword');
    expect( secrets.salt ).not.toBe('testme');
    expect( await AccountService.checkPassword(new Account(), 'testme') ).toBe(false);
    expect( await AccountService.checkPassword(new Account(), 'newPassword') ).toBe(true);
});