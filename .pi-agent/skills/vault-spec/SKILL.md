---
type: skill
name: vault-spec
description: Create structured spec documents in the Obsidian vault from user requests. Places specs in the correct folder, uses templates, and adds backlinks.
trigger: "/vault-spec"
tags:
  - skill
  - obsidian
  - planning
  - documentation
---

# /vault-spec — Vault Specification Writer

When the user asks for a spec, plan, feature request, or structured document to be placed in the Obsidian vault, follow this workflow.

## Trigger

User says `/vault-spec` followed by a description, or says anything like:
- "make a spec for X"
- "write up a plan and put it in [folder]"
- "create a feature request for..."
- "document this idea in the vault"

## Workflow

### 1. Understand the request
- What is being spec'd? (feature, plan, integration, research)
- What type of document? (plan, feature request, research note, dev log entry)
- Any explicit folder instructions from the user?

### 2. Determine the right folder

| Document type | Folder | Template |
|--------------|--------|----------|
| Feature request | Project's `feature-requests/` folder if it exists, else create it | `Templates/PI Cockpit - Feature Request.md` |
| General plan / roadmap | `0-Inbox/` | Frontmatter with `status: planning` |
| Research / architecture | `0-Inbox/` | Frontmatter with relevant tags |
| Dev log updates | `1-Projects/<current project>/` | Append to existing dev log, follow its format |

**For dev log entries:**
1. Check `current_project` from context (e.g., `{{AGENT_NAME}}-vaultkeeper`, `{{AGENT_NAME}}`)
2. Scan `1-Projects/<Project>/` for a `*- Dev Log.md` file
3. If found: append new entry at the top, following the file's timestamp format
4. If not found: create `1-Projects/<Project>/<Project> - Dev Log.md` with the standard header
5. Always run `date` for the timestamp — never guess

### 3. Research if needed
- Check existing code, read relevant files
- Look at the PI Cockpit hub, plugin, or bot as context demands
- Reference the dev log for recent changes

### 4. Write the document
- Use Obsidian frontmatter: `created`, `status`, `tags`, `relates_to`
- Use `[[wikilinks]]` for backlinks to related documents
- If a template exists in `Templates/`, use its structure
- Keep it structured and scannable (headings, bullet lists, tables)
- Include acceptance criteria for feature requests
- Include implementation phases for plans

### 5. Confirm
- Tell the user the path and filename
- If backlinks are used, list what it links to
- Ask if anything needs changing

## Examples

**Feature request:**
```
/vault-spec for a notification bell on sessions that shows unread turns
```
→ Creates `1-Projects/PI Cockpit/feature-requests/Session Notification Bells.md` using the feature request template, backlinks to the consolidation plan.

**Integration plan:**
```
/vault-spec how to connect the telegram bot to the pi cockpit hub
```
→ Creates `0-Inbox/Telegram Bot — PI Cockpit Integration Plan.md` with architecture diagram, implementation phases, and risks.

**Dev log:**
```
/vault-spec log what we just built
```
→ Checks `current_project` context, finds (or creates) that project's dev log in `1-Projects/<Project>/`, appends entry at top with `date` timestamp.

## Folder Rules

- `0-Inbox/` — planning, research, architecture docs that aren't tied to a specific project
- `1-Projects/<Project>/` — project-specific plans, dev logs, feature requests
- `1-Projects/<Project>/feature-requests/` — individual feature requests (create if missing)
- `Templates/` — templates only, never put specs here

## Formatting Rules

- Always use Obsidian frontmatter with at minimum: `created`, `tags`
- Use `[[wikilinks]]` not markdown links for internal references
- Use relative paths in wikilinks: `[[../1-Projects/PI Cockpit/feature-requests/Name|Label]]`
- Timestamps in `YYYY-MM-DD` format
- Status values: `planning`, `backlog`, `in-progress`, `done`, `blocked`
