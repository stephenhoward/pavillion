class AccountAlreadyExistsError extends Error {
  constructor() {
    super('Account already exists');
  }
}

class noAccountExistsError extends Error {
    constructor() {
        super('Account does not exist');
    }
}

class noAccountInviteExistsError extends Error {
    constructor() {
        super('Account Invitation does not exist');
    }
}

class noAccountApplicationExistsError extends Error {
    constructor() {
        super('Account Application does not exist');
    }
}

class AccountInviteAlreadyExistsError extends Error {
    constructor() {
      super('Account Invitation already exists');
    }
}

class AccountApplicationAlreadyExistsError extends Error {
    constructor() {
      super('Account Application already exists');
    }
}

class AccountApplicationsClosedError extends Error {
    constructor() {
      super('Account Applications are closed');
    }
}

class AccountRegistrationClosedError extends Error {
    constructor() {
      super('Account Registration is closed');
    }
}

export {
    AccountAlreadyExistsError,
    AccountInviteAlreadyExistsError,
    AccountApplicationAlreadyExistsError,
    noAccountExistsError,
    noAccountInviteExistsError,
    noAccountApplicationExistsError,
    AccountApplicationsClosedError,
    AccountRegistrationClosedError
 };