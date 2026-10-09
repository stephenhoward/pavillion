# Theme parity probe

Temporary tooling for the theme-token migration. `probe.ts` records the computed colour and shadow styling of a fixed element list on every public site and widget page. It covers every colour mode and the interaction states. It also diffs two captures. The final parity run deletes this directory.

## Run

The seed shifts its dates relative to the server's current date. So a parity check is authoritative only when the base and the candidate are captured on the same day. On the day of the check, capture a fresh base at `266a0baf` and diff the candidate against that.

```bash
# 1. Base: builds 266a0baf in a throwaway git worktree under the OS temp
#    dir (npm ci, npm run build), captures it, then removes the worktree.
npx tsx tests/theme-parity/probe.ts capture-base "$SCRATCH/base.json"

# 2. Candidate: the working tree. Build it first, because a stale dist/
#    probes the old CSS without any warning.
npm run build
npx tsx tests/theme-parity/probe.ts capture "$SCRATCH/candidate.json"

# 3. Compare.
npx tsx tests/theme-parity/probe.ts diff "$SCRATCH/base.json" "$SCRATCH/candidate.json"
```

`$SCRATCH` is any directory outside the repo, such as the session scratchpad. Running `capture-base` takes about two minutes. To do its steps by hand:

1. `git worktree add --detach "$SCRATCH/base-wt" 266a0baf`
2. Copy `probe.ts` to `tests/theme-parity/` inside the worktree.
3. Run `npm ci && npm run build && npx tsx tests/theme-parity/probe.ts capture "$SCRATCH/base.json"` in the worktree.
4. `git worktree remove --force "$SCRATCH/base-wt"`

`capture` starts its own server on a free port from 3100 to 3200. The server uses the e2e environment: built assets and a freshly seeded database. `--base-url URL` probes a server that is already running. `--screenshots DIR` also saves the date-picker shots.

`diff` compares values as exact strings, with one exception. Colours that differ only in alpha, by at most `ALPHA_EPSILON` (0.005, boundary included), are listed in their own section and do not fail the diff. Elements absent from both captures are listed but not compared. That margin covers `calc()` serialisation. Every other difference counts as a real deviation, and so does an element that appears or disappears. The command exits 1 when any real deviation exists. Record each deviation on the epic. Only the color-scheme / native-control change is pre-approved.

## What it covers

- **Modes.** Site: OS light and OS dark. Widget: auto under OS light, auto under OS dark, forced light on an OS-dark browser, and forced dark on an OS-light browser. Forced modes use `?colorMode=` on a top-level widget load.
- **Properties.** `color`, `background-color`, `background-image`, the four `border-*-color`, `outline-color`, `box-shadow`, `filter`, `backdrop-filter`, `fill` and `stroke`. `color-scheme` is inherited, so it is read only on `#app` and `.widget-root`.
- **States.** `:hover`, `:focus`, `:focus-visible` and `:active` are forced through CDP. Class and attribute states (`.absent`, `.selected`, `.has-filter`, `.active`, `aria-invalid`, `disabled`) are either real or set for the read and then reverted. The probe also captures the open date popover, custom dates, the open language switcher, the report dialog, `::before`/`::after`/`::placeholder`/`::backdrop`, and the `::-webkit-calendar-picker-indicator` UA part.
- **Element list.** Fixed per step. It was derived from a pass over the style blocks of `src/site/assets/style.scss`, `src/site/components`, `src/widget/components` and `src/common/ui`: every rule that sets a colour, border, outline, shadow or filter, includes a colour-bearing `public-*` mixin, or carries a `public-dark-mode` block. The cascade-restatement checkpoints are explicit entries: `public-filter-pill` absent/selected, `public-input-base` hover/focus, and search-filter-public's dark blocks.
- **Seed.** The series is `/test_calendar/series/summer_festival`, from `j_event_series.json` (three events in `x_event.json`). Its first event carries the seed's only image. Some elements are never rendered by the seed: cancelled badges, a repost source pill, a ticket link, accessibility notes, the instance page's series link (the instance API omits `event.series`), series pagination, and the empty and error states. The `*.decorated` / `.empty` / `.error` steps reach these by stubbing the API response they render from.

Transitions and animations are disabled while the probe reads. This keeps reads stable and changes none of the compared properties. A failing step reports its page and mode key.
