import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DateTime } from 'luxon';
import config from 'config';

import { Account } from "@/common/model/account"
import AccountInvitation from '@/common/model/invitation';
import CommonAccountService from '@/server/common/service/accounts';
import EmailService from "@/server/common/service/mail";
import { AccountEntity, AccountSecretsEntity, AccountInvitationEntity, AccountApplicationEntity } from "@/server/common/entity/account"
import ServiceSettings from '@/server/configuration/service/settings';
import CalendarService from '@/server/calendar/service/calendar';
import { AccountApplicationAlreadyExistsError, noAccountInviteExistsError, AccountRegistrationClosedError, AccountApplicationsClosedError, AccountAlreadyExistsError, AccountInviteAlreadyExistsError, noAccountApplicationExistsError } from '@/server/accounts/exceptions';

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
     * Sends the owner of the provided email a message inviting them to create an account,
     * if they do not already have an account.
     * @param email
     * @param message
     * @returns a promise that resolves to undefined
     * @throws AccountAlreadyExistsError if an account already exists for the provided email
     * @throws AccountInviteAlreadyExistsError if an invitation already exists for the provided email
     */
    static async inviteNewAccount(email:string, message: string): Promise<AccountInvitation> {

        if ( await CommonAccountService.getAccountByEmail(email) ) {
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

        return invitation.toModel();
    }

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

        EmailService.sendEmail(email, 'Welcome to our service', 'Thank you for registering' + accountInfo.password_code);
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

        EmailService.sendEmail(application.email, 'Thank you for applying to our service', 'Thank you for applying');

        return true;
    }

    static async _setupAccount(email: string, password?: string): Promise<AccountInfo> {
        if ( await CommonAccountService.getAccountByEmail(email) ) {
            throw new AccountAlreadyExistsError();
        }

        const accountEntity = AccountEntity.build({
            id: uuidv4(),
            email: email,
            username: ''
        });

        await accountEntity.save();

        // TODO: add creating a username as a required step to having a valid account

        const accountSecretsEntity = AccountSecretsEntity.build({ account_id: accountEntity.id });

        if( password ) {
            await accountSecretsEntity.save();
            CommonAccountService.setPassword(accountEntity.toModel(), password);
        }
        else {
            accountSecretsEntity.password_reset_code = randomBytes(16).toString('hex');
            accountSecretsEntity.password_reset_expiration = DateTime.now().plus({ hours: 1}).toJSDate();
            await accountSecretsEntity.save();
        }

        const calendar = await CalendarService.createCalendarForUser(accountEntity.toModel());

        return {
            account: accountEntity.toModel(),
            password_code: accountSecretsEntity.password_reset_code
        };
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

    static async sendNewAccountInvite(invitation:AccountInvitationEntity): Promise<boolean> {

        EmailService.sendEmail(invitation.email, 'Welcome to our service', 'Thank you for applying' + invitation.invitation_code);
        return true;
    }

    static async acceptAccountApplication(id: string): Promise<Account|undefined> {

        const application = await AccountApplicationEntity.findByPk(id);

        if (! application ) {
            throw new noAccountApplicationExistsError();
        }

        const accountInfo = await AccountService._setupAccount(application.email);

        EmailService.sendEmail(accountInfo.account.email, 'Welcome to our service', 'Thank you for applying' + accountInfo.password_code);
        return accountInfo.account;
    }

    static async rejectAccountApplication(id: string): Promise<undefined> {

        const application = await AccountApplicationEntity.findByPk(id);

        if (! application ) {
            throw new noAccountApplicationExistsError();
        }

        application.destroy();
        EmailService.sendEmail(application.email, 'Your account application was declined', 'Thank you for applying');
    }

    static async listInvitations(): Promise<AccountInvitation[]> {
        return (await AccountInvitationEntity.findAll()).map( (invitation) => invitation.toModel() );
    }

    static async listAccountApplications(): Promise<AccountInvitation[]> {
        return (await AccountApplicationEntity.findAll()).map( (application) => application.toModel() );
    }

    static async getAccount(id: string): Promise<Account|null> {
        const account = await AccountEntity.findByPk(id);
        return account ? account.toModel() : null;
    }

    static async getAccountFromUsername(name: string, domain?: string): Promise<Account|null> {

        let account = !domain || config.get('domain') == domain
            ? await AccountEntity.findOne({ where: {
                username: name
            } })
            : await AccountEntity.findOne({ where: {
                username: name,
                domain: domain
            } });

        if ( account ) {
            return account.toModel();
        }
        return null;
    }
}

export default AccountService;