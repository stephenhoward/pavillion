import { describe, it, expect, afterEach } from 'vitest';
import sinon from 'sinon';
import AuthenticationService from '../service/auth';
import CommonAccountService from '../../common/service/accounts';
import { AccountEntity, AccountSecretsEntity } from '../../common/entity/account';
import { Account } from '../../../common/model/account';
import moment from 'moment';


describe( 'checkPassword', async () => {
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    afterEach( () => {
        sandbox.restore();
    });

    it( 'should return true', async () => {
        let findSecretStub = sandbox.stub(AccountSecretsEntity, 'findOne');
        let pkSecretStub = sandbox.stub(AccountSecretsEntity, 'findByPk');
        let saveStub = sandbox.stub(AccountSecretsEntity.prototype, 'save');

        let account = new Account('1234', 'testme', 'testme');
        let secrets = AccountSecretsEntity.build({
            account_id: '1234',
        });

        pkSecretStub.resolves( secrets );

        expect( await CommonAccountService.setPassword(account, 'newPassword') ).toBe(true);
        expect( secrets.password ).not.toBe('testme');
        expect( secrets.password ).not.toBe('newPassword');
        expect( secrets.salt ).not.toBe('testme');
        expect( await AuthenticationService.checkPassword(new Account(), 'testme') ).toBe(false);
        expect( await AuthenticationService.checkPassword(new Account(), 'newPassword') ).toBe(true);
    });

    it( 'should return false if no secret is found', async () => {
        let findSecretStub = sandbox.stub(AccountSecretsEntity, 'findByPk');
        findSecretStub.resolves( undefined );

        expect( await AuthenticationService.checkPassword(new Account(), 'testme') ).toBe(false);
    });

    it( 'should return false if no salt is found', async () => {
        let findSecretStub = sandbox.stub(AccountSecretsEntity, 'findByPk');
        let secrets = AccountSecretsEntity.build({
            account_id: '1234',
        });

        findSecretStub.resolves( secrets );

        expect( await AuthenticationService.checkPassword(new Account(), 'testme') ).toBe(false);
    });

});

describe('resetPassword', async () => {
    let sandbox: sinon.SinonSandbox = sinon.createSandbox();

    afterEach( () => {
        sandbox.restore();
    });

    it('should return undefined if no secret is found', async () => {
        let findSecretStub = sandbox.stub(AccountSecretsEntity, 'findOne');
        findSecretStub.resolves(undefined);

        expect( await AuthenticationService.resetPassword('1234', 'password') ).toBe(undefined);
    });

    it('should return undefined if the code is expired', async () => {
        let findSecretStub = sandbox.stub(AccountSecretsEntity, 'findOne');
        let saveStub = sandbox.stub(AccountSecretsEntity.prototype, 'save');
        let secrets = AccountSecretsEntity.build({
            password_reset_expiration: moment().subtract(1, 'day'),
            password_reset_code: '1234',
        });

        findSecretStub.resolves( secrets );

        expect( await AuthenticationService.resetPassword('1234', 'password') ).toBe(undefined);
        expect(secrets.password_reset_code).toBe(null);
        expect(secrets.password_reset_expiration).toBe(null);
    });

    it('should return the account if the password is set', async () => {
        let findSecretStub = sandbox.stub(AccountSecretsEntity, 'findOne');
        let setPassSttub = sandbox.stub(CommonAccountService, 'setPassword');
        let saveStub = sandbox.stub(AccountSecretsEntity.prototype, 'save');
        setPassSttub.resolves(true);
        let account = AccountEntity.build({ id: '1234', username: 'testme', email: 'testme'});
        let secrets = AccountSecretsEntity.build({
            password_reset_expiration: moment().add(1, 'day'),
            password_reset_code: '1234',
        });
        secrets.account = account;

        findSecretStub.resolves( secrets );

        let acct = await AuthenticationService.resetPassword('1234', 'password');
        expect( acct ).not.toBe(undefined);
        if ( acct ) {
            expect( acct.id ).toBe(account.id);
        }
        expect(secrets.password_reset_code).toBe(null);
        expect(secrets.password_reset_expiration).toBe(null);
    });
});