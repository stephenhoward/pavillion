import { scryptSync, randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import moment from 'moment';
import ServiceSettings from './settings';
import { AccountEntity, AccountSecretsEntity, AccountApplicationEntity, AccountInvitationEntity } from "../entity/account"
import { Account } from "../model/account"
import sendEmail from "./mail";
import { AccountAlreadyExistsError, AccountInviteAlreadyExistsError, AccountApplicationAlreadyExistsError, noAccountInviteExistsError, noAccountApplicationExistsError, AccountRegistrationClosedError, AccountApplicationsClosedError } from '../exceptions/account_exceptions';

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

    /**
     * Creates a new account for the provided email address, if it does not yet exist
     * @param - email the email address to associate with the new account
     * @returns a promise that resolves to a boolean
     */
    static async registerNewAccount(email:string): Promise<Account> {

        const settings = await ServiceSettings.getInstance();
        if ( settings.get('registrationMode') != 'open' ) {
            throw new AccountRegistrationClosedError();
        }
        const accountInfo = await AccountService._setupAccount(email);

        sendEmail(email, 'Welcome to our service', 'Thank you for registering' + accountInfo.password_code);
        return accountInfo.account;
    }

    /**
     * Sends the owner of the provided email a message inviting them to create an account,
     * if they do not already have an account.
     * @param email
     * @param message
     * @returns a promise that resolves to undefined
     * @throws AccountAlreadyExistsError if an account already exists for the provided email
     * @throws AccountInviteAlreadyExistsError if an invitation already exists for the provided email
     */
    static async inviteNewAccount(email:string, message: string): Promise<undefined> {

        if ( await AccountService.getAccountByEmail(email) ) {
            throw new AccountAlreadyExistsError();
        }

        if ( await AccountInvitationEntity.findOne({ where: { email: email }}) ) {
            throw new AccountInviteAlreadyExistsError();
        }

        const invitation = AccountInvitationEntity.build({
            id: uuidv4(),
            email: email,
            message: message,
            invitation_code: randomBytes(16).toString('hex')
        });

        await invitation.save()
        AccountService.sendNewAccountInvite(invitation);

        return;
    }

    static async sendNewAccountInvite(invitation:AccountInvitationEntity): Promise<boolean> {

        sendEmail(invitation.email, 'Welcome to our service', 'Thank you for applying' + invitation.invitation_code);
        return true;
    }

    static async applyForNewAccount(email:string, message: string): Promise<boolean> {

        const settings = await ServiceSettings.getInstance();
        if ( settings.get('registrationMode') != 'apply' ) {
            throw new AccountApplicationsClosedError();
        }

        if ( await AccountApplicationEntity.findOne({ where: { email: email }}) ) {
            throw new AccountApplicationAlreadyExistsError();
        }

        const application = AccountApplicationEntity.build({
            id: uuidv4(),
            email: email,
            message: message
        });

        sendEmail(application.email, 'Thank you for applying to our service', 'Thank you for applying');

        return true;
    }

    static async validateInviteCode(code: string): Promise<boolean> {
        const invitation = await AccountInvitationEntity.findOne({ where: {invitation_code: code}});
        if ( invitation ) {
            return true;
        }
        return false;
    }

    static async acceptAccountInvite(code: string, password: string): Promise<Account|undefined> {
        const invitation = await AccountInvitationEntity.findOne({ where: {invitation_code: code}});

        if (! invitation ) {
            throw new noAccountInviteExistsError();
        }

        const accountInfo = await AccountService._setupAccount(invitation.email,password);

        return accountInfo.account;
    }

    static async acceptAccountApplication(id: string): Promise<Account|undefined> {

        const application = await AccountApplicationEntity.findByPk(id);

        if (! application ) {
            throw new noAccountApplicationExistsError();
        }

        const accountInfo = await AccountService._setupAccount(application.email);

        sendEmail(accountInfo.account.email, 'Welcome to our service', 'Thank you for applying' + accountInfo.password_code);
        return accountInfo.account;
    }

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

    static async validatePasswordResetCode(code: string): Promise<boolean> {
        const secret = await AccountSecretsEntity.findOne({ where: {password_reset_code: code}});

        if ( secret ) {
            if ( moment().isBefore(secret.password_reset_expiration) ) {
                return true;
            }
        }
        return false;
    }

    static async resetPassword(code: string, password: string): Promise<boolean> {
        const secret = await AccountSecretsEntity.findOne({ where: {password_reset_code: code}});

        if ( secret ) {
            if ( moment().isBefore(secret.password_reset_expiration) ) {
                return AccountService._setPasswordOnSecret(secret, password);
            }
            else {
                secret.password_reset_code = null;
                secret.password_reset_expiration = null;
                await secret.save();
            }
        }
        return false;
    }

    static async checkPassword(account:Account, password:string): Promise<boolean> {
        const secret = await AccountSecretsEntity.findByPk(account.id);

        if ( secret && secret.salt ) {
            let hashed_password = scryptSync(password, secret.salt, 64 ).toString('hex');
            if ( hashed_password === secret.password ) {
                return true;
            }
        }
        return false;
    }

    static async setPassword(account:Account, password:string): Promise<boolean> {
        const secret = await AccountSecretsEntity.findByPk(account.id);

        if ( secret ) {
            return this._setPasswordOnSecret(secret, password);
        }
        return false;
    }

    static async _setPasswordOnSecret(secret:AccountSecretsEntity, password:string): Promise<boolean> {

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