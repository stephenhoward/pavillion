import { AccountEntity } from '../entity/account';

class Account {
    id: string = '';
    username: string = '';
    email: string = '';
    profile: Profile | null = null;

    constructor (id?: string, username?: string, email?: string) {
        this.id = id ?? '';
        this.username = username ?? '';
        this.email = email ?? '';
    };

    static fromEntity (entity: AccountEntity): Account {
        return new Account( entity.id, entity.username, entity.email );
    };

};

class AccountSecrets {
    accountId: string = '';
    password: string = '';
    url_verification_code: string = '';
};

class Profile {
    declare username: string;
    declare description: string;
    declare url: string;
};

export { Account, AccountSecrets, Profile}