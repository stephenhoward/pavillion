# budget-watch

A Claude Code mod (plugin of function hooks) that appends `[budget]` lines the
model reads when a loop's context fill or an account rate-limit window crosses
a band, and resumes work after a five-hour limit resets. It carries no policy:
what an agent does with a line is defined in AGENTS.md ("Budget signals") and
the role skills.

## Lines it appends

- `[budget] context 47% (main)` / `[budget] context 42% (agent a1b2c3d4, implementer)`
  — per loop, from `contextStart` (40%) every `contextStep` (5%). A drop
  (compaction) re-arms silently.
- `[budget] session five-hour 82%, resets 02:05 PM, about 25 min at current rate`
  — at `fiveHourBands` (70,80,90,95) and `sevenDayBands` (90,95), to main and
  every running subagent. The burn-rate clause appears once readings span five
  minutes.
- Auto-resume: when a main-loop turn dies on an error while a window is at 99%
  or more, `resumePrompt` is submitted one minute after the reset. Five-hour
  always; seven-day only when the reset is within `sevenDayResumeHours`; a
  gateway spend limit never. `autoResume: false` turns it off.

`/budget` shows readings, bands and any planned resume. `/budget resume off`
cancels a planned resume. Every threshold is a `userConfig` field in
`.claude-plugin/plugin.json`, editable from `/config`.

## Loading

Claude Code does not load `.agents/mods/` on its own.

- One session: `claude --plugin-dir .agents/mods/budget-watch`
- Every session: set `CLAUDE_CODE_PLUGIN_DIRS` to the absolute path in the
  `env` block of `~/.claude/settings.json` (the engine reads it only from the
  user file, never a project settings file; several folders join with `:`).

An interactive session watches the folder and hot-reloads on save.

## Checking it

```
claude plugin validate .agents/mods/budget-watch   # one expected warning: no author
claude plugin test .agents/mods/budget-watch       # 14 tests
```

`claude plugin test` must run outside the Bash tool's sandbox. If it reports
"hooks modules are turned off in this process", start `claude` once with
network access and retry.

## Known limitations (Claude Code 2.1.288)

- The plugin-test kit never delivers a plugin's own `$.session.append` to a
  test hook, so the tests observe the debug-log line the mod writes beside
  every append (`<line> -> <target>`, `{ to: 'debug' }`) rather than the row.
  The real append is exercised only in a live session; `claude --debug` shows
  every line.
- A subagent's percentage is measured against the main session's context
  window, so a subagent on a model with a different window is approximate.
- Validator rules worth knowing before editing: every function that receives
  `$` must be declared at the top level of the module, and `$.state`
  references must be literal `{ plugin, key }` objects at the call site (only
  `id` may be computed).
