class AccountApplication {
  declare id: string;
  declare email: string;
  declare message: string;
  declare status: string;
  declare statusTimestamp: Date | null;

  constructor(id: string, email: string, message?: string, status?: string, statusTimestamp?: Date) {
    this.id = id;
    this.email = email;
    this.message = message ?? '';
    this.status = status ?? 'pending';
    this.statusTimestamp = statusTimestamp ?? null;
  }
};

export default AccountApplication;
