import { DomainEventHandlers } from '@/server/common/types/domain';
import AuthenticationInterface from '../interface';

export class AuthenticationEventHandlers implements DomainEventHandlers {
  private service: AuthenticationInterface;

  constructor(service: AuthenticationInterface) {
    this.service = service;
  }

  install(): void {
    // No event handlers for authentication domain currently
    // Authentication operations are typically synchronous request/response
    // This structure is here for future use if needed (e.g., audit logging, notifications)
  }
}
