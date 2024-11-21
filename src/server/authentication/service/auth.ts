import { scryptSync, randomBytes } from 'crypto';
import moment from 'moment';
import { AccountEntity, AccountSecretsEntity, AccountApplicationEntity, AccountInvitationEntity } from "../../common/entity/account"
import { Account } from "../../../common/model/account"
import CommonAccountService from '../../common/service/accounts';

/**
 * Service class for managing accounts
 *
 * @remarks
 * Use this class to manage the lifecycle of accounts in the system
 */
class AuthenticationService {

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

    static async validatePasswordResetCode(code: string): Promise<boolean> {
        const secret = await AccountSecretsEntity.findOne({where: {password_reset_code: code}});

        if ( secret ) {
            if ( moment().isBefore(secret.password_reset_expiration) ) {
                return true;
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
}

export default AuthenticationService;