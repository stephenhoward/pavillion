import { scryptSync, randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import moment from 'moment';
import ServiceSettings from './settings';
import { AccountEntity, AccountSecretsEntity, AccountApplicationEntity, AccountInvitationEntity } from "../entity/account"
import { Account } from "../../../common/model/account"
import sendEmail from "./mail";
import { AccountAlreadyExistsError, AccountInviteAlreadyExistsError, AccountApplicationAlreadyExistsError, noAccountInviteExistsError, noAccountApplicationExistsError, AccountRegistrationClosedError, AccountApplicationsClosedError } from '../../exceptions/account_exceptions';

type AccountInfo = {
    account: Account,
    password_code: string | null
};

/**
 * Service class for managing accounts
 *
 * @remarks
 * Use this class to manage the lifecycle of accounts in the system
 */
class AccountService {

    static async getAccountByEmail(email: string): Promise<Account|undefined> {
        const account = await AccountEntity.findOne({ where: {email: email}});

        if ( account ) {
            return Account.fromEntity(account);
        }
    }

    static async getAccountById(id: string): Promise<Account|undefined> {
        const account = await AccountEntity.findByPk(id);

        if ( account ) {
            return Account.fromEntity(account);
        }
    }

    static async setPassword(account:Account, password:string): Promise<boolean> {
        const secret = await AccountSecretsEntity.findByPk(account.id);

        if ( secret ) {
            let salt = randomBytes(16).toString('hex');
            let hashed_password = scryptSync(password, salt, 64 ).toString('hex');

            secret.salt = salt;
            secret.password = hashed_password;
            secret.password_reset_code = null;
            secret.password_reset_expiration = null;

            await secret.save();

            return true;
        }
        return false;
    }


    static async _setupAccount(email: string, password?: string): Promise<AccountInfo> {
        if ( await AccountService.getAccountByEmail(email) ) {
            throw new AccountAlreadyExistsError();
        }

        const accountEntity = AccountEntity.build({
            id: uuidv4(),
            email: email,
            username: ''
        });

        await accountEntity.save();

        const accountSecretsEntity = AccountSecretsEntity.build({ account_id: accountEntity.id });

        if( password ) {
            await accountSecretsEntity.save();
            AccountService.setPassword(Account.fromEntity(accountEntity), password);
        }
        else {
            accountSecretsEntity.password_reset_code = randomBytes(16).toString('hex');
            accountSecretsEntity.password_reset_expiration = moment().add(1,'hours').toDate();
            await accountSecretsEntity.save();
        }

        return {
            account: Account.fromEntity(accountEntity),
            password_code: accountSecretsEntity.password_reset_code
        };
    }
}

export default AccountService;