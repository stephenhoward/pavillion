import { glob } from 'glob';
import path from 'path';

/**
 * Dynamically imports all entity files from src/server/ * /entity/ *.ts.
 *
 * Each entity file calls db.addModels() at import time, which registers
 * the entity on the Sequelize singleton. This avoids maintaining a manual
 * list of entity imports.
 */
export async function importAllEntities(): Promise<string[]> {
  const projectRoot = process.cwd();
  const pattern = 'src/server/*/entity/*.ts';

  const files = await glob(pattern, { cwd: projectRoot });

  // Filter out db.ts, index.ts, and test files
  const entityFiles = files
    .filter((f) => {
      const basename = path.basename(f);
      return !basename.startsWith('db.')
        && basename !== 'index.ts'
        && !basename.endsWith('.test.ts');
    })
    .sort();

  console.log(`[entity-registry] Discovered ${entityFiles.length} entity files:`);
  for (const f of entityFiles) {
    console.log(`  - ${f}`);
  }

  // Import each file — this triggers db.addModels() side effects
  for (const f of entityFiles) {
    const fullPath = path.join(projectRoot, f);
    await import(fullPath);
  }

  return entityFiles;
}
