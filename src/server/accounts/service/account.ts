import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { Account } from "../../../common/model/account"
import moment from 'moment';
import CommonAccountService from '../../common/service/accounts';
import ServiceSettings from '../../common/service/settings';
import sendEmail from "../../common/service/mail";
import { AccountEntity, AccountSecretsEntity, AccountInvitationEntity, AccountApplicationEntity } from "../../common/entity/account"
import { AccountApplicationAlreadyExistsError, noAccountInviteExistsError, AccountRegistrationClosedError, AccountApplicationsClosedError, AccountAlreadyExistsError, AccountInviteAlreadyExistsError, noAccountApplicationExistsError } from '../../exceptions/account_exceptions';
import AccountInvitation from '../../../common/model/invitation';

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

        const accountSecretsEntity = AccountSecretsEntity.build({ account_id: accountEntity.id });

        if( password ) {
            await accountSecretsEntity.save();
            CommonAccountService.setPassword(accountEntity.toModel(), password);
        }
        else {
            accountSecretsEntity.password_reset_code = randomBytes(16).toString('hex');
            accountSecretsEntity.password_reset_expiration = moment().add(1,'hours').toDate();
            await accountSecretsEntity.save();
        }

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

        sendEmail(invitation.email, 'Welcome to our service', 'Thank you for applying' + invitation.invitation_code);
        return true;
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

    static async rejectAccountApplication(id: string): Promise<undefined> {

        const application = await AccountApplicationEntity.findByPk(id);

        if (! application ) {
            throw new noAccountApplicationExistsError();
        }

        sendEmail(application.email, 'Your account application was declined', 'Thank you for applying');
    }

    static async listInvitations(): Promise<AccountInvitation[]> {
        return (await AccountInvitationEntity.findAll()).map( (invitation) => invitation.toModel() );
    }

    static async listAccountApplications(): Promise<AccountInvitation[]> {
        return (await AccountApplicationEntity.findAll()).map( (application) => application.toModel() );
    }
}

export default AccountService;