import { EventEmitter } from 'events';
import { Account } from '@/common/model/account';
import AccountInvitation from '@/common/model/invitation';
import AccountApplication from '@/common/model/application';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';

export default class AccountsInterface {
  private accountService: AccountService;

  constructor(
    eventBus: EventEmitter,
    configurationInterface: ConfigurationInterface,
  ) {
    this.accountService = new AccountService(eventBus, configurationInterface);
  }

  async getAccountByEmail(email: string): Promise<Account | undefined> {
    return this.accountService.getAccountByEmail(email);
  }

  async getAccountById(id: string): Promise<Account | undefined> {
    return this.accountService.getAccountById(id);
  }

  async setPassword(account: Account, password: string): Promise<boolean> {
    return this.accountService.setPassword(account, password);
  }

  async loadAccountRoles(account: Account): Promise<Account> {
    return this.accountService.loadAccountRoles(account);
  }

  async validateInviteCode(code: string): Promise<boolean> {
    return this.accountService.validateInviteCode(code);
  }

  async isRegisteringAccount(account: Account): Promise<boolean> {
    return this.accountService.isRegisteringAccount(account);
  }

  async registerNewAccount(email: string): Promise<Account | undefined> {
    return this.accountService.registerNewAccount(email);
  }

  async applyForNewAccount(email: string, message: string): Promise<boolean> {
    return this.accountService.applyForNewAccount(email, message);
  }

  async listAccountApplications(): Promise<AccountApplication[]> {
    return this.accountService.listAccountApplications();
  }

  async acceptAccountApplication(id: string): Promise<Account> {
    return this.accountService.acceptAccountApplication(id);
  }

  async rejectAccountApplication(id: string, silent: boolean): Promise<void> {
    return this.accountService.rejectAccountApplication(id, silent);
  }

  async cancelInvite(id: string): Promise<boolean> {
    return this.accountService.cancelInvite(id);
  }
  async resendInvite(id: string): Promise<AccountInvitation | undefined> {
    return this.accountService.resendInvite(id);
  }
  async inviteNewAccount(email: string, message: string): Promise<AccountInvitation> {
    return this.accountService.inviteNewAccount(email, message);
  }
  async acceptAccountInvite(code: string, password: string): Promise<Account | undefined> {
    return this.accountService.acceptAccountInvite(code, password);
  }
  async listInvitations(): Promise<AccountInvitation[]> {
    return this.accountService.listInvitations();
  }

}
