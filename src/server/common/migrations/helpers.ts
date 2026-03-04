import { QueryInterface } from 'sequelize';

/**
 * Check whether a column exists on a table.
 */
export async function columnExists(
  queryInterface: QueryInterface,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const description = await queryInterface.describeTable(tableName);
  return columnName in description;
}

/**
 * Check whether a table exists.
 */
export async function tableExists(
  queryInterface: QueryInterface,
  tableName: string,
): Promise<boolean> {
  const tables = await queryInterface.showAllTables();
  return tables.includes(tableName);
}

/**
 * Add a column only if it does not already exist.
 */
export async function addColumnIfNotExists(
  queryInterface: QueryInterface,
  tableName: string,
  columnName: string,
  attributes: Parameters<QueryInterface['addColumn']>[2],
): Promise<void> {
  if (await columnExists(queryInterface, tableName, columnName)) {
    console.log(`Column ${tableName}.${columnName} already exists, skipping.`);
    return;
  }
  await queryInterface.addColumn(tableName, columnName, attributes);
}

/**
 * Remove a column only if it exists.
 */
export async function removeColumnIfExists(
  queryInterface: QueryInterface,
  tableName: string,
  columnName: string,
): Promise<void> {
  if (!(await columnExists(queryInterface, tableName, columnName))) {
    console.log(`Column ${tableName}.${columnName} does not exist, skipping removal.`);
    return;
  }
  await queryInterface.removeColumn(tableName, columnName);
}

/**
 * Rename a column only if the old name exists (and the new name does not).
 */
export async function renameColumnIfExists(
  queryInterface: QueryInterface,
  tableName: string,
  oldName: string,
  newName: string,
): Promise<void> {
  const desc = await queryInterface.describeTable(tableName);
  if (newName in desc) {
    console.log(`Column ${tableName}.${newName} already exists, skipping rename from ${oldName}.`);
    return;
  }
  if (!(oldName in desc)) {
    console.log(`Column ${tableName}.${oldName} does not exist, skipping rename to ${newName}.`);
    return;
  }
  await queryInterface.renameColumn(tableName, oldName, newName);
}

/**
 * Create a table only if it does not already exist.
 */
export async function createTableIfNotExists(
  queryInterface: QueryInterface,
  tableName: string,
  attributes: Parameters<QueryInterface['createTable']>[1],
  options?: Parameters<QueryInterface['createTable']>[2],
): Promise<void> {
  if (await tableExists(queryInterface, tableName)) {
    console.log(`Table ${tableName} already exists, skipping creation.`);
    return;
  }
  await queryInterface.createTable(tableName, attributes, options);
}
