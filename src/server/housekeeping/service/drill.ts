import { v4 as uuidv4 } from 'uuid';
import { BackupDrillEntity } from '@/server/housekeeping/entity/drill';

/**
 * Longest `detail` this service will store.
 *
 * The bound lives here rather than at the CLI so there is one place that decides
 * it. The drill script only ever passes fixed literals, all of them far shorter
 * than this, so the cap is a guard against a future caller rather than a limit
 * the current one approaches.
 */
export const DRILL_DETAIL_MAX_LENGTH = 500;

/**
 * A completed restore drill as read back across the housekeeping boundary.
 */
export interface DrillRecord {
  id: string;
  /** The dump the drill ran against. A filename, never a backup id. */
  backupFilename: string;
  ranAt: Date;
  passed: boolean;
  /** Short failure reason, or null on a pass. */
  detail: string | null;
}

/**
 * Input for recording one completed drill.
 */
export interface DrillResultInput {
  backupFilename: string;
  passed: boolean;
  detail?: string | null;
}

/**
 * Records and reads restore-drill outcomes.
 *
 * The write is the drill's only touch of the live database, and it is a single
 * append — no update, no delete, one table. Everything the drill actually proves
 * happens inside a throwaway container that cannot reach this database at all.
 */
export default class DrillService {
  /**
   * Appends one completed drill run.
   *
   * Called (through HousekeepingInterface) by the CLI's `backup record-drill`
   * verb, which scripts/restore-drill.sh invokes once per completed run.
   *
   * @param input - The dump drilled, the verdict, and an optional short reason
   * @param ranAt - When the drill completed; defaults to now
   */
  async recordResult(input: DrillResultInput, ranAt: Date = new Date()): Promise<void> {
    const detail = input.detail ? input.detail.slice(0, DRILL_DETAIL_MAX_LENGTH) : null;

    await BackupDrillEntity.create({
      id: uuidv4(),
      backup_filename: input.backupFilename,
      ran_at: ranAt,
      passed: input.passed,
      detail,
    });
  }

  /**
   * Reads the most recent drill that passed.
   *
   * Failed runs are ignored rather than reported as the latest drill: the
   * question this answers is "when did a restore last actually work", so a
   * failure after a success must not make the successful drill invisible.
   *
   * @returns The newest passing drill, or null when none has ever passed
   */
  async getLastSuccessful(): Promise<DrillRecord | null> {
    const row = await BackupDrillEntity.findOne({
      where: { passed: true },
      order: [['ran_at', 'DESC']],
    });

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      backupFilename: row.backup_filename,
      ranAt: row.ran_at,
      passed: row.passed,
      detail: row.detail ?? null,
    };
  }
}
