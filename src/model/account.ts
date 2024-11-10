import { AccountEntity } from '../entity/account';

class Account {
    id: string = '';
    username: string = '';
    email: string = '';
    profile: Profile | null = null;

    constructor (entity: AccountEntity) {
        this.id = entity.id;
        this.username = entity.username;
        this.email = entity.email;
    }
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