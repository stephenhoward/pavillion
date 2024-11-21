class AccountInvitation {
    declare id: string;
    declare email: string;
    declare message: string;

    constructor(id: string, email: string, message?: string) {
        this.id = id;
        this.email = email;
        this.message = message ?? '';
    }
};

export default AccountInvitation;