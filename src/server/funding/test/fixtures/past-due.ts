import { FundingPlanEntity } from '@/server/funding/entity/funding_plan';

/**
 * Move a past-due plan's dunning clock back, as if its payment had failed at
 * `since`. Both the funding-access gate and the suspension job measure the
 * grace period from `past_due_since`.
 *
 * Written through the model, so the value is stored in the format Sequelize
 * reads back, and as a bulk update, so the status hooks that own the column
 * do not run and overwrite it.
 *
 * @param planId - Plan to backdate
 * @param since - When the plan is to have become past due
 */
export async function backdatePastDue(planId: string, since: Date): Promise<void> {
  await FundingPlanEntity.update({ past_due_since: since }, { where: { id: planId } });
}
