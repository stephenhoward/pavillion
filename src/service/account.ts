import { AccountEntity, AccountSecretsEntity } from "../entity/account"
import { Account } from "../model/account"
import { scryptSync, randomBytes } from 'crypto';

const AccountService = {

    getAccountByEmail: async (email: string): Promise<Account|undefined> => {
        const account = await AccountEntity.findOne({ where: {email: email}});

        if ( account ) {
            return new Account(account);
        }
    },
    getAccountById: async (id: string): Promise<Account|undefined> => {
        const account = await AccountEntity.findOne({ where: {id: id}});

        if ( account ) {
            return new Account(account);
        }
    },
    checkPassword: async (account:Account, password:string): Promise<boolean> => {
        const secret = await AccountSecretsEntity.findByPk(account.id);

        if ( secret ) {
            let hashed_password = scryptSync(password, secret.salt, 64 ).toString('hex');
            if ( hashed_password === secret.password ) {
                return true;
            }
        }
        return false;
    },
    setPassword: async (account:Account, password:string): Promise<boolean> => {
        const secret = await AccountSecretsEntity.findByPk(account.id);
        // TODO: hash password and compare
        if ( secret ) {
            let salt = randomBytes(16).toString('hex');
            let hashed_password = scryptSync(password, salt, 64 ).toString('hex');
            secret.salt = salt;
            secret.password = hashed_password;
            //TODO save to database
            return true;
        }
        return false;
    }
}

export default AccountService;