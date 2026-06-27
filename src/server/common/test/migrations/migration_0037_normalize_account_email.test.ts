import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Sequelize, DataTypes, QueryTypes } from 'sequelize';
import migration from '../../../../../migrations/0037_normalize_account_email';

/**
 * Migration 0037 normalizes (lowercase + trim) stored email addresses across
 * `account`, `account_application`, and `account_invitation`, then enforces
 * case-insensitive uniqueness with a unique index on `account.email`. A
 * pre-mutation collision check aborts the migration (leaving all data
 * untouched) when two account rows normalize to the same value, surfacing the
 * conflicting account IDs only.
 */
describe('Migration 0037: normalize account email + unique index', () => {
  let sequelize: Sequelize;

  beforeEach(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    });

    const qi = sequelize.getQueryInterface();
    for (const table of ['account', 'account_application', 'account_invitation']) {
      await qi.createTable(table, {
        id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
        email: { type: DataTypes.STRING, allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false },
        updatedAt: { type: DataTypes.DATE, allowNull: false },
      });
    }
  });

  afterEach(async () => {
    await sequelize.close();
  });

  async function insertRow(table: string, id: string, email: string | null) {
    const now = new Date().toISOString();
    await sequelize.query(
      `INSERT INTO ${table} (id, email, "createdAt", "updatedAt")
       VALUES (:id, :email, :now, :now)`,
      { replacements: { id, email, now }, type: QueryTypes.INSERT },
    );
  }

  async function getEmail(table: string, id: string): Promise<string | null> {
    const [row] = await sequelize.query(
      `SELECT email FROM ${table} WHERE id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT },
    ) as Array<{ email: string | null }>;
    return row ? row.email : null;
  }

  async function uniqueIndexExists(): Promise<boolean> {
    const indexes = await sequelize.getQueryInterface().showIndex('account') as Array<{
      name: string;
    }>;
    return indexes.some((ix) => ix.name === 'account_email_unique');
  }

  it('lowercases + trims email across all three tables and adds the unique index', async () => {
    await insertRow('account', 'a1', 'Victim@X.com');
    await insertRow('account', 'a2', '  Spaced@Example.COM  ');
    await insertRow('account', 'a3', 'already@normal.com');
    await insertRow('account_application', 'app1', 'Applicant@Y.com');
    await insertRow('account_invitation', 'inv1', '  Invitee@Z.com ');

    await migration.up({ context: sequelize });

    expect(await getEmail('account', 'a1')).toBe('victim@x.com');
    expect(await getEmail('account', 'a2')).toBe('spaced@example.com');
    expect(await getEmail('account', 'a3')).toBe('already@normal.com');
    expect(await getEmail('account_application', 'app1')).toBe('applicant@y.com');
    expect(await getEmail('account_invitation', 'inv1')).toBe('invitee@z.com');
    expect(await uniqueIndexExists()).toBe(true);
  });

  it('leaves NULL emails untouched and does not collide them', async () => {
    await insertRow('account', 'n1', null);
    await insertRow('account', 'n2', null);

    await migration.up({ context: sequelize });

    expect(await getEmail('account', 'n1')).toBeNull();
    expect(await getEmail('account', 'n2')).toBeNull();
    expect(await uniqueIndexExists()).toBe(true);
  });

  it('aborts before any mutation when two account rows normalize equal', async () => {
    await insertRow('account', 'dup1', 'Victim@x.com');
    await insertRow('account', 'dup2', 'victim@X.com');
    await insertRow('account_application', 'app1', 'Mixed@Case.com');

    await expect(migration.up({ context: sequelize })).rejects.toThrow(/aborted/);

    // No table was modified: account rows retain original casing, the
    // application row was not backfilled, and the index was not created.
    expect(await getEmail('account', 'dup1')).toBe('Victim@x.com');
    expect(await getEmail('account', 'dup2')).toBe('victim@X.com');
    expect(await getEmail('account_application', 'app1')).toBe('Mixed@Case.com');
    expect(await uniqueIndexExists()).toBe(false);
  });

  it('surfaces the conflicting account IDs (not emails) in the abort error', async () => {
    await insertRow('account', 'dup1', 'Victim@x.com');
    await insertRow('account', 'dup2', 'victim@X.com');

    let message = '';
    try {
      await migration.up({ context: sequelize });
    }
    catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/dup1.*dup2|dup2.*dup1/);
    expect(message).toContain('dup1');
    expect(message).toContain('dup2');
    // The plaintext email must never appear in diagnostics.
    expect(message.toLowerCase()).not.toContain('victim@x.com');
  });

  it('down() drops the unique index and does not restore casing', async () => {
    await insertRow('account', 'a1', 'Victim@X.com');

    await migration.up({ context: sequelize });
    expect(await uniqueIndexExists()).toBe(true);
    expect(await getEmail('account', 'a1')).toBe('victim@x.com');

    await migration.down({ context: sequelize });
    expect(await uniqueIndexExists()).toBe(false);
    // Backfill is irreversible: casing stays normalized after down().
    expect(await getEmail('account', 'a1')).toBe('victim@x.com');
  });
});
