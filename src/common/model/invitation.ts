class AccountInvitation {
    declare id: string;
    declare email: string;
    declare message: string;
    declare expirationTime: Date | null;

    constructor(id: string, email: string, message?: string, expirationTime?: Date) {
        this.id = id;
        this.email = email;
        this.message = message ?? '';
        this.expirationTime = expirationTime ?? null;
    }

    toObject(): Record<string, any> {
        return {
            id: this.id,
            email: this.email,
            message: this.message,
            expirationTime: this.expirationTime
        };
    }
    static fromObject(obj: Record<string, any>): AccountInvitation {
        return new AccountInvitation(
            obj.id || '',
            obj.email,
            obj.message,
            obj.expirationTime ? new Date(obj.expirationTime) : undefined
        );
    }
};

export default AccountInvitation;