import { Sequelize } from 'sequelize-typescript';

interface ColumnInfo {
  type: string;
  allowNull: boolean;
  primaryKey: boolean;
  unique: boolean;
  defaultValue: unknown;
}

type TableSchema = Record<string, ColumnInfo>;

export interface SchemaDifference {
  missingTables: string[];
  extraTables: string[];
  missingColumns: { table: string; column: string }[];
  extraColumns: { table: string; column: string }[];
  constraintMismatches: {
    table: string;
    column: string;
    field: string;
    migration: unknown;
    entity: unknown;
  }[];
}

/** Tables created internally by Sequelize/Umzug, not by our entities */
const INTERNAL_TABLES = ['SequelizeMeta', 'sqlite_sequence'];

/**
 * Lists all user-defined tables in a SQLite database.
 */
export async function getTableNames(sequelize: Sequelize): Promise<string[]> {
  const qi = sequelize.getQueryInterface();
  const tables = await qi.showAllTables();
  return tables.filter((t) => !INTERNAL_TABLES.includes(t)).sort();
}

/**
 * Gets column-level schema information for a table.
 */
export async function getTableSchema(
  sequelize: Sequelize,
  tableName: string,
): Promise<TableSchema> {
  const qi = sequelize.getQueryInterface();
  return await qi.describeTable(tableName) as TableSchema;
}

/**
 * Compares two schemas and returns all discrepancies.
 *
 * @param migrationDb - Sequelize instance where migrations were run
 * @param entityDb - Sequelize instance where db.sync() was run from entities
 * @returns Differences between the two schemas
 */
export async function compareSchemas(
  migrationDb: Sequelize,
  entityDb: Sequelize,
): Promise<SchemaDifference> {
  const migrationTables = await getTableNames(migrationDb);
  const entityTables = await getTableNames(entityDb);

  const missingTables = entityTables.filter((t) => !migrationTables.includes(t));
  const extraTables = migrationTables.filter((t) => !entityTables.includes(t));

  const missingColumns: SchemaDifference['missingColumns'] = [];
  const extraColumns: SchemaDifference['extraColumns'] = [];
  const constraintMismatches: SchemaDifference['constraintMismatches'] = [];

  // Compare columns for tables that exist in both
  const sharedTables = entityTables.filter((t) => migrationTables.includes(t));

  for (const table of sharedTables) {
    const migrationSchema = await getTableSchema(migrationDb, table);
    const entitySchema = await getTableSchema(entityDb, table);

    const migrationCols = Object.keys(migrationSchema);
    const entityCols = Object.keys(entitySchema);

    // Columns in entities but missing from migrations
    for (const col of entityCols) {
      if (!migrationCols.includes(col)) {
        missingColumns.push({ table, column: col });
      }
    }

    // Columns in migrations but not in entities (warnings, not failures)
    for (const col of migrationCols) {
      if (!entityCols.includes(col)) {
        extraColumns.push({ table, column: col });
      }
    }

    // Check constraints for shared columns
    const sharedCols = entityCols.filter((c) => migrationCols.includes(c));
    for (const col of sharedCols) {
      const mCol = migrationSchema[col];
      const eCol = entitySchema[col];

      // Skip allowNull comparison for primary key columns — SQLite's
      // describeTable() reports PKs as allowNull:true after sync() even
      // though they have NOT NULL constraints. This is a known SQLite quirk.
      if (mCol.allowNull !== eCol.allowNull && !mCol.primaryKey && !eCol.primaryKey) {
        constraintMismatches.push({
          table, column: col, field: 'allowNull',
          migration: mCol.allowNull, entity: eCol.allowNull,
        });
      }

      if (mCol.primaryKey !== eCol.primaryKey) {
        constraintMismatches.push({
          table, column: col, field: 'primaryKey',
          migration: mCol.primaryKey, entity: eCol.primaryKey,
        });
      }
    }
  }

  return { missingTables, extraTables, missingColumns, extraColumns, constraintMismatches };
}
