# Index Standards

Rebuild and maintain the standards index file (`index.yml`).

## Purpose

The index enables `/inject-standards` to suggest relevant standards without reading all files. It maps each standard to a brief description for quick matching.

## Process

### Step 1: Scan for Skills with Standards Files

1. List all directories in `.claude/skills/`
2. For each skill directory, list all `.md` files **excluding SKILL.md**
3. Build a list of all standards organized by skill:
   ```
   backend-api/api.md
   backend-entity-model/entity-model.md
   global-coding-style/coding-style.md
   global-conventions/conventions.md
   consistency-playbook/api-interface.md
   consistency-playbook/data-model.md
   ```

### Step 2: Load Existing Index

Read `.claude/skills/standards-routing/index.yml` if it exists. Note which entries already have descriptions.

### Step 3: Identify Changes

Compare the file scan with the existing index:

- **New files** — Standards files without index entries
- **Deleted files** — Index entries for files that no longer exist
- **Existing files** — Already indexed, keep as-is

### Step 4: Handle New Files

For each new standard file that needs an index entry:

1. Read the file to understand its content
2. Use AskUserQuestion to propose a description:

```
New standard needs indexing:
  Skill: backend-api
  File: api.md

Suggested description: "API response envelope structure and error format"

Accept? (yes / or type a better description)
```

Keep descriptions to **one short sentence** — they're for matching, not documentation.

### Step 5: Handle Deleted Files

If there are index entries for files that no longer exist:

1. List them for the user
2. Remove them from the index automatically (no confirmation needed)

Report: "Removed 2 stale index entries: backend-api/old-pattern.md, testing-test-writing/deprecated.md"

### Step 6: Write Updated Index

Generate `.claude/skills/standards-routing/index.yml` with this structure:

```yaml
skill-name:
  file-name:
    description: Brief description here
```

**Rules:**
- Alphabetize skills
- Alphabetize files within each skill
- File names without `.md` extension
- One-line descriptions only
- Exclude SKILL.md files — only companion `.md` files matter

**Example:**
```yaml
backend-api:
  api:
    description: API handler patterns, route structure, response format

backend-entity-model:
  entity-model:
    description: Entity/model separation, toModel/fromModel patterns

global-coding-style:
  coding-style:
    description: General coding style, formatting, linting rules

global-conventions:
  conventions:
    description: File naming, variable naming, class naming conventions
```

### Step 7: Report Results

Summarize what changed:

```
Index updated:
  + 2 new entries added
  - 1 stale entry removed
  = 8 entries unchanged

Total: 9 standards indexed
```

## When to Run

- After creating or deleting skill companion files
- If `/inject-standards` suggestions seem out of sync
- To clean up a messy or outdated index

**Note:** `/discover-standards` runs this automatically as its final step, so you usually don't need to call it separately after discovering standards.

## Output

Updates `.claude/skills/standards-routing/index.yml`
