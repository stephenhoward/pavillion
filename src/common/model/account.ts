import { AccountEntity, AccountRoleEntity } from '../../server/common/entity/account';

class Account {
    id: string = '';
    username: string = '';
    email: string = '';
    profile: Profile | null = null;
    roles: string[] | null = null;

    constructor (id?: string, username?: string, email?: string) {
        this.id = id ?? '';
        this.username = username ?? '';
        this.email = email ?? '';
    };

    hasRole(role: string): boolean {
        if ( this.roles ) {
            return this.roles.includes(role);
        }
        return false;
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