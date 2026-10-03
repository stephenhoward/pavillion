export type BudgetWatchSample = { at: number; percent: number };
export type BudgetWatchResume = { at: number; windows: string };

declare module 'claude-code' {
  interface PluginState {
    'budget-watch': {
      /** The last context band appended per loop: 'main' or an agent id. */
      context: StateFamily<number | null>
      /** The last session band appended per rate-limit window kind. */
      session: StateFamily<number | null>
      /** Recent readings per window kind, for the burn-rate estimate. */
      samples: StateFamily<BudgetWatchSample[]>
      /** The resume the mod has planned, or null. */
      resume: BudgetWatchResume | null
    }
  }
}
