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
import { AccountApplicationAlreadyExistsError, noAccountInviteExistsError, AccountRegistrationClosedError, AccountApplicationsClosedError, AccountAlreadyExistsError, AccountInviteAlreadyExistsError, noAccountApplicationExistsError } from '@/server/accounts/exceptions';
import AuthenticationService from '@/server/authentication/service/auth';
import AccountRegistrationEmail from '@/server/accounts/model/registration_email';
import AccountInvitationEmail from '@/server/accounts/model/invitation_email';
import ApplicationAcceptedEmail from '@/server/accounts/model/application_accepted_email';
import ApplicationRejectedEmail from '@/server/accounts/model/application_rejected_email';
import ApplicationAcknowledgmentEmail from '@/server/accounts/model/application_acknowledgment_email';

type AccountInfo = {
    account: Account,
    password_code: string | ''
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
     * Resends an invitation email and resets the expiration time
     * @param id - The ID of the invitation to resend
     * @returns a promise that resolves to the updated invitation or undefined if not found
     */
    static async resendInvite(id: string): Promise<AccountInvitation|undefined> {
        const invitation = await AccountInvitationEntity.findByPk(id);
        if (!invitation) {
            return undefined;
        }

        // Reset expiration time to 1 week from now
        const oneWeekFromNow = new Date();
        oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);
        invitation.expiration_time = oneWeekFromNow;

        await invitation.save();

        // Resend the invitation email
        await AccountService.sendNewAccountInvite(invitation);

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

        const message = new AccountRegistrationEmail(accountInfo.account, accountInfo.password_code);
        EmailService.sendEmail(message.buildMessage(accountInfo.account.language));
        return accountInfo.account;
    }

    /**
     * Allows a user to apply for an account when registration mode is set to 'apply'
     *
     * @param email - The email address of the applicant
     * @param message - Any message the applicant wants to include with their application
     * @returns A promise that resolves to true if the application was successfully created
     * @throws AccountApplicationsClosedError if registration mode is not set to 'apply'
     * @throws AccountApplicationAlreadyExistsError if an application already exists for the provided email
     */
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

        await application.save();

        // Send acknowledgment email to the applicant
        const acknowledgmentEmail = new ApplicationAcknowledgmentEmail(application.toModel());
        await EmailService.sendEmail(acknowledgmentEmail.buildMessage('en'));

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
        await accountSecretsEntity.save();

        let accountInfo:AccountInfo = {
            account: accountEntity.toModel(),
            password_code: ''
        };

        if( password ) {
            CommonAccountService.setPassword(accountEntity.toModel(), password);
        }
        else {
            const passwordResetCode = await AuthenticationService.generatePasswordResetCodeForAccount(accountEntity.toModel());
            accountInfo.password_code = passwordResetCode;
        }
        return accountInfo;
    }

    static async validateInviteCode(code: string): Promise<boolean> {
        const invitation = await AccountInvitationEntity.findOne({ where: {invitation_code: code}});
        if (!invitation) {
            return false;
        }

        // Check if invitation has expired
        // If expiration time is null, consider the invitation expired
        if (!invitation.expiration_time) {
            return false;
        }

        const now = DateTime.utc();
        const expirationTime = DateTime.fromJSDate(invitation.expiration_time);

        if (now > expirationTime) {
            return false;
        }

        return true;
    }

    static async acceptAccountInvite(code: string, password: string): Promise<Account|undefined> {
        // Check if invitation code is valid (not expired)
        const isValid = await AccountService.validateInviteCode(code);
        if (!isValid) {
            throw new Error('Invitation has expired or does not exist');
        }

        // At this point, we know the code is valid, so retrieve the invitation
        const invitation = await AccountInvitationEntity.findOne({ where: {invitation_code: code}});

        if (!invitation) {
            throw new noAccountInviteExistsError();
        }

        const accountInfo = await AccountService._setupAccount(invitation.email, password);

        // Remove the invitation after it's been accepted
        await invitation.destroy();

        return accountInfo.account;
    }

    static async sendNewAccountInvite(invitation:AccountInvitationEntity): Promise<boolean> {

        const message = new AccountInvitationEmail(invitation.toModel(), invitation.invitation_code);
        EmailService.sendEmail(message.buildMessage('en'));
        return true;
    }

    /**
     * Approves an account application and creates a new account for the applicant
     *
     * @param id - The ID of the application to approve
     * @returns A promise that resolves to the newly created account or undefined if there was an error
     * @throws noAccountApplicationExistsError if no application exists with the given ID
     */
    static async acceptAccountApplication(id: string): Promise<Account|undefined> {

        const application = await AccountApplicationEntity.findByPk(id);

        if (! application ) {
            throw new noAccountApplicationExistsError();
        }

        const accountInfo = await AccountService._setupAccount(application.email);

        // Send email before destroying the application
        const message = new ApplicationAcceptedEmail(accountInfo.account, accountInfo.password_code);
        EmailService.sendEmail(message.buildMessage(accountInfo.account.language));

        // Delete the application now that it's been accepted and account created
        await application.destroy();

        return accountInfo.account;
    }

    /**
     * Rejects an account application and optionally notifies the applicant
     *
     * @param id - The ID of the application to reject
     * @param silent - If true, no email notification will be sent to the applicant (default: false)
     * @returns A promise that resolves to undefined
     * @throws noAccountApplicationExistsError if no application exists with the given ID
     */
    static async rejectAccountApplication(id: string, silent: boolean = false): Promise<undefined> {
        const application = await AccountApplicationEntity.findByPk(id);

        if (!application) {
            throw new noAccountApplicationExistsError();
        }

        // Update application status instead of destroying it
        application.status = 'rejected';
        application.status_timestamp = new Date();
        await application.save();

        if (!silent) {
            const message = new ApplicationRejectedEmail(application.toModel());
            await EmailService.sendEmail(message.buildMessage('en'));
        }
    }

    static async listInvitations(): Promise<AccountInvitation[]> {
        return (await AccountInvitationEntity.findAll()).map( (invitation) => invitation.toModel() );
    }

    static async listAccountApplications(): Promise<AccountInvitation[]> {
        return (await AccountApplicationEntity.findAll()).map( (application) => application.toModel() );
    }

    /**
     * Deletes an account invitation by ID
     * @param id - The ID of the invitation to delete
     * @returns a promise that resolves to true if successful, false if not found
     */
    static async cancelInvite(id: string): Promise<boolean> {
        const invitation = await AccountInvitationEntity.findByPk(id);
        if (!invitation) {
            return false;
        }

        await invitation.destroy();
        return true;
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

    static async isRegisteringAccount(account: Account): Promise<boolean> {
        const secretsEntity = await AccountSecretsEntity.findByPk(account.id);
        if ( secretsEntity ) {
            console.log("secretsEntity", secretsEntity);
            if ( secretsEntity.password?.length ) {
                return false;
            }
        }
        return true;
    }

}

export default AccountService;