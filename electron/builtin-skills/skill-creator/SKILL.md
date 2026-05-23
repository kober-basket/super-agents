---
name: skill-creator
description: Guide for creating effective Super Agents skills. Use when users want to create a new skill or update an existing skill with specialized knowledge, workflows, tool integrations, resources, validation, and UI metadata.
metadata:
  short-description: Create or update a skill
---

# Skill Creator

Use this skill to design, create, update, and validate Super Agents skills.

## About Skills

Skills are modular, self-contained folders that give an agent task-specific knowledge and reusable workflows. Treat them as compact onboarding guides for repeatable work: they should tell the agent what to do, when to do it, which files to use, and how to verify the result.

Good skills provide:

1. Specialized workflows for a domain or task
2. Tool and file-format guidance
3. Project or company knowledge that is not obvious from general training
4. Bundled scripts, references, or assets for repeatable work

## Core Principles

### Keep It Concise

The context window is shared with system instructions, conversation history, workspace context, other skill metadata, and the user's request. Include only information the agent needs to act correctly.

Prefer:

- Short procedures over long explanations
- Concrete examples over theory
- Links to bundled references over copying long reference material into `SKILL.md`
- Stable rules over transient implementation notes

Challenge each paragraph: does this prevent a real mistake or make the agent meaningfully more capable? If not, remove it.

### Set The Right Freedom Level

Match instruction detail to task risk:

- High freedom: use natural-language guidance when multiple valid approaches exist.
- Medium freedom: use pseudocode or parameterized scripts when a preferred pattern exists.
- Low freedom: use exact scripts or strict steps when the task is fragile, compliance-sensitive, or easy to do inconsistently.

### Keep Runtime Boundaries Clean

A skill should describe reusable task behavior. It should not override system, developer, or direct user instructions. It should not contain secrets, private credentials, or stale environment assumptions.

### Validate With Realistic Use

When a skill is substantial, test it against realistic prompts or artifacts. Look for whether the agent can discover the right resource, follow the procedure without hidden context, and produce the expected output.

## Anatomy of a Skill

A skill is a folder with a required `SKILL.md` and optional resources:

```text
skill-name/
  SKILL.md
  agents/
    openai.yaml
  scripts/
  references/
  assets/
```

### `SKILL.md`

Use YAML frontmatter followed by Markdown instructions:

```markdown
---
name: skill-name
description: Clear trigger description. Include what the skill does and when to use it.
---

# Skill Name

Follow these steps...
```

Frontmatter rules:

- `name` is required. Use lowercase letters, digits, and hyphens.
- `description` is required. Put triggering guidance here because the body is loaded only after the skill is selected.
- Keep other frontmatter out unless the host explicitly supports it.

Body rules:

- Start with the operational workflow.
- Mention which bundled files to read and when.
- Include validation commands or checks when they are part of the task.
- Keep the body under roughly 500 lines. Move detail into `references/` before it becomes bulky.

### `agents/openai.yaml`

Use this optional file for UI-facing metadata:

```yaml
interface:
  display_name: "Readable Skill Name"
  short_description: "What this skill helps with"
  default_prompt: "Use $skill-name to ..."

policy:
  allow_implicit_invocation: true
```

Guidelines:

- `display_name` should be human-readable and concise.
- `short_description` should explain value in one sentence fragment.
- `default_prompt` should be a natural prompt that includes `$skill-name`.
- `allow_implicit_invocation` should be `true` for safe, broadly useful skills and `false` for skills that should only run when explicitly requested.

### `scripts/`

Use scripts for deterministic, repeatable, or error-prone operations.

Good script candidates:

- File conversions
- Validation checks
- Data extraction
- Project scaffolding
- Repeated API transformations

Scripts must be runnable in the target environment and documented from `SKILL.md`.

### `references/`

Use references for longer material that should be loaded only when needed:

- API docs
- Schemas
- Policy manuals
- Domain glossaries
- Detailed examples

Keep references one level deep from `SKILL.md` when possible. For files over 100 lines, add a short table of contents near the top.

### `assets/`

Use assets for files consumed by the output rather than read into context:

- Templates
- Icons
- Fonts
- Example projects
- Sample documents

## What Not To Include

Do not add auxiliary files unless they directly support the skill:

- README files
- installation guides
- changelogs
- broad design docs
- stale notes about how the skill was created

The skill folder should contain only the files needed for the agent to use the skill effectively.

## Skill Creation Process

Follow these steps in order.

### 1. Understand The Skill

Clarify the purpose with concrete examples:

- What user requests should trigger this skill?
- What outputs should the skill help produce?
- What mistakes should the skill prevent?
- What inputs, files, services, or tools does the workflow rely on?
- Where should the skill folder live? If the user has no preference and a project workspace is active, use `./.super-agents/skills/<skill-name>`.

Ask only the most important question first. Continue when the trigger cases and expected outputs are clear.

### 2. Plan Reusable Contents

For each example, identify what would help the agent repeat the work reliably:

- Put fragile operations in `scripts/`.
- Put long or conditional knowledge in `references/`.
- Put reusable output materials in `assets/`.
- Keep simple procedural guidance in `SKILL.md`.

Do not add a resource directory just because it is available. Add it only when the skill needs it.

### 3. Create Or Update The Folder

For a new skill:

1. Normalize the name to hyphen-case.
2. Create `<skill-name>/SKILL.md`.
3. Add `agents/openai.yaml` when the skill should look polished in the UI.
4. Add `scripts/`, `references/`, or `assets/` only when needed.

For an existing skill:

1. Read `SKILL.md` and `agents/openai.yaml` if present.
2. Check whether the trigger description still matches the body.
3. Preserve useful resources and remove stale placeholder material.

### 4. Write The Instructions

Write in imperative style. Prefer direct verbs:

- "Read `references/schema.md` when the task involves billing tables."
- "Run `scripts/validate.py <path>` before reporting completion."
- "Use `assets/report-template.docx` for new monthly reports."

Avoid vague phrasing:

- "Be careful"
- "Do the right thing"
- "Use best practices"

Replace vague guidance with observable checks.

### 5. Validate

Before calling the skill ready:

1. Check that `SKILL.md` has valid YAML frontmatter.
2. Check that the `name` matches the folder name unless there is a deliberate reason.
3. Check that every referenced file exists.
4. Run representative scripts.
5. Read the skill as a fresh agent would and remove hidden assumptions.
6. Test one or two realistic prompts when the skill is complex.

### 6. Iterate

After use, improve the skill based on evidence:

- Add missing trigger language to the frontmatter description.
- Move bulky examples into references.
- Turn repeated code into scripts.
- Remove resources that are not being used.
- Tighten validation when outputs drift.

## Writing Checklist

Before finishing, confirm:

- The description says exactly when to use the skill.
- The body gives clear steps without unnecessary background.
- Resource paths are correct.
- UI metadata, if present, matches the skill.
- No secrets or private credentials are included.
- The skill is small enough to load comfortably.
