import { scryptSync, randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import moment from 'moment';
import ServiceSettings from '../../common/service/settings';
import { AccountEntity, AccountSecretsEntity, AccountApplicationEntity, AccountInvitationEntity } from "../../common/entity/account"
import { Account } from "../../../common/model/account"
import sendEmail from "../../common/service/mail";
import { AccountAlreadyExistsError, AccountInviteAlreadyExistsError, AccountApplicationAlreadyExistsError, noAccountInviteExistsError, noAccountApplicationExistsError, AccountRegistrationClosedError, AccountApplicationsClosedError } from '../../exceptions/account_exceptions';
import CommonAccountService from '../../common/service/accounts';

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
        const accountInfo = await CommonAccountService._setupAccount(email);

        sendEmail(email, 'Welcome to our service', 'Thank you for registering' + accountInfo.password_code);
        return accountInfo.account;
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

        const accountInfo = await CommonAccountService._setupAccount(invitation.email,password);

        return accountInfo.account;
    }

    static async validatePasswordResetCode(code: string): Promise<boolean> {
        const secret = await AccountSecretsEntity.findOne({where: {password_reset_code: code}});

        if ( secret ) {
            if ( moment().isBefore(secret.password_reset_expiration) ) {
                return true;
            }
        }
        return false;
    }

    static async resetPassword(code: string, password: string): Promise<Account| undefined> {
        const secret = await AccountSecretsEntity.findOne({ where: {password_reset_code: code}, include: AccountEntity});

        if ( secret ) {

            if ( moment().isBefore(secret.password_reset_expiration) ) {
                const account = secret.account.toModel();

                if ( await CommonAccountService.setPassword(account, password) == true ) {
                    return account;
                }
            }
            else {
                secret.password_reset_code = null;
                secret.password_reset_expiration = null;
                await secret.save();
            }
        }
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
}

export default AccountService;