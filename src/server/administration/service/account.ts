import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { Account } from "../../../common/model/account"
import CommonAccountService from '../../common/service/accounts';
import sendEmail from "../../common/service/mail";
import { AccountInvitationEntity, AccountApplicationEntity } from "../../common/entity/account"
import { AccountAlreadyExistsError, AccountInviteAlreadyExistsError, noAccountApplicationExistsError } from '../../exceptions/account_exceptions';

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
    static async inviteNewAccount(email:string, message: string): Promise<undefined> {

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

        return;
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

        const accountInfo = await CommonAccountService._setupAccount(application.email);

        sendEmail(accountInfo.account.email, 'Welcome to our service', 'Thank you for applying' + accountInfo.password_code);
        return accountInfo.account;
    }
}

export default AccountService;