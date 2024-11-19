import { AccountEntity, AccountRoleEntity } from '../entity/account';

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

    static fromEntity (entity: AccountEntity): Account {
        return new Account( entity.id, entity.username, entity.email );
    };

    async hasRole(role: string): Promise<boolean> {
        await this.loadRoles();
        if ( this.roles ) {
            return this.roles.includes(role);
        }
        return false;
    }

    async loadRoles(): Promise<void> {
        if ( this.roles == null ) {
            let roles = await AccountRoleEntity.findAll({ where: { account_id: this.id } });
            if ( roles ) {
                this.roles = roles.map( (role) => role.role );
            }
            else {
                this.roles = [];
            }
        }
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