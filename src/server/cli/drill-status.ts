/**
 * The restore-drill section of `pavillion backup status`.
 *
 * Kept out of cli/index.ts because that module runs main() on import, which
 * makes its handlers untestable in-process. This file only formats a record the
 * CLI has already fetched through HousekeepingInterface (DEC-003).
 */

import chalk from 'chalk';
import { DateTime } from 'luxon';
import type { DrillRecord } from '../housekeeping/interface/index.js';

/**
 * Builds the output lines for the last successful restore drill.
 *
 * The section deliberately names what it proves — a restore — and contrasts
 * itself with the Last Backup "Verified" mark, which only means the dump file
 * was written at a plausible size. An operator must not read the two as the
 * same thing.
 *
 * @param drill - The newest passing drill, or null if none has ever passed
 * @returns Lines to print, the first being the section heading
 */
export function formatDrillStatus(drill: DrillRecord | null): string[] {
  const lines = [chalk.cyan('Last Successful Restore Drill:')];

  if (drill) {
    const date = DateTime.fromJSDate(drill.ranAt).toFormat('yyyy-MM-dd HH:mm:ss');
    lines.push(`  Date: ${date}`);
    lines.push(`  Restored backup: ${drill.backupFilename}`);
  }
  else {
    lines.push(chalk.yellow('  No successful restore drill recorded — no backup has been proven restorable'));
    lines.push(`  ${chalk.dim('(Run scripts/restore-drill.sh to prove one)')}`);
  }

  lines.push(`  ${chalk.dim('("Verified" on a backup means its file was written; only a drill proves it restores)')}`);
  return lines;
}
