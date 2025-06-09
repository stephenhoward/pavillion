import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import AuthenticationService from '../service/auth';
import AccountsInterface from '@/server/accounts/interface';

/**
 * Implementation of the Authentication Internal API.
 * Aggregates functionality from AuthenticationService.
 */
export default class AuthenticationInterface {
  private authenticationService: AuthenticationService;

  constructor(
    eventBus: EventEmitter,
    accountsInterface: AccountsInterface,
  ) {
    this.authenticationService = new AuthenticationService(eventBus, accountsInterface);
  }

  async checkPassword(account: Account, password: string): Promise<boolean> {
    return this.authenticationService.checkPassword(account, password);
  }

  async generatePasswordResetCode(email: string): Promise<void> {
    return this.authenticationService.generatePasswordResetCode(email);
  }

  async generatePasswordResetCodeForAccount(account: Account): Promise<string> {
    return this.authenticationService.generatePasswordResetCodeForAccount(account);
  }

  async validatePasswordResetCode(code: string): Promise<boolean> {
    return this.authenticationService.validatePasswordResetCode(code);
  }

  async resetPassword(code: string, password: string): Promise<Account | undefined> {
    return this.authenticationService.resetPassword(code, password);
  }

  async changeEmail(account: Account, newEmail: string, password: string): Promise<Account> {
    return this.authenticationService.changeEmail(account, newEmail, password);
  }
}
