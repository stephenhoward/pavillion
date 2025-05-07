import { PrimaryModel } from '@/common/model/model';

class Account extends PrimaryModel {
  username: string = '';
  email: string = '';
  profile: Profile | null = null;
  roles: string[] | null = null;
  calendarLanguages: string[] = ['en'];
  language: string = 'en';

  constructor (id?: string, username?: string, email?: string) {
    super(id);
    this.username = username ?? '';
    this.email = email ?? '';
  };

  hasRole(role: string): boolean {
    if ( this.roles ) {
      return this.roles.includes(role);
    }
    return false;
  }

  toObject(): Record<string,any> {
    return {
      id: this.id,
      username: this.username,
      email: this.email,
      profile: this.profile,
      roles: this.roles,
    };
  };
  static fromObject(obj: Record<string,any>): Account {
    let account = new Account(obj.id, obj.username, obj.email);
    account.profile = obj.profile;
    account.roles = obj.roles;
    return account;
  }

  clone(): Account { return Account.fromObject(this.toObject()); }
};

class Profile {
  declare id: string;
  declare username: string;
  declare domain: string;
  declare url: string;
};

export { Account, Profile};
