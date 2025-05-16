export class EmailAlreadyExistsError extends Error {
  constructor(message?: string) {
    super(message || 'Email address already in use');
    this.name = 'EmailAlreadyExistsError';
  }
}

export class InvalidPasswordError extends Error {
  constructor() {
    super('Invalid password');
    this.name = 'InvalidPasswordError';
  }
}
