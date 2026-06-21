# Agent instructions (fixpoints inbox)

This directory is the inbox of "fixpoints" (edit points) collected by **VisualPrompt**.

## Structure
- `pending/` — fixpoints not yet processed. `fp-NNN.json` (structured data) + `fp-NNN.md` (summary for humans/agents).
- `applied/` — fixpoints that have been processed and moved here.

## Processing steps
1. Read each `fp-NNN.md` in `pending/`.
2. Use the "Edit instruction" and the "Source-code search clues" (search terms/candidate files) to find the target source in the repo.
   - Frontend search terms: grep for `data-testid=...`, `.class`, `#id`, `component:...`.
   - If `target.repoRoot` is present, search within that repo (local mode).
3. Edit the source per the instruction. Change only the target element precisely and do not touch unrelated code.
4. Move the processed fixpoint files (`.json`, `.md`) to `applied/`.

## Key JSON schema fields
- `prompt`     — the edit instruction written by the user
- `element`    — { tag, id, selector, xpath, rect, text, classes }
- `clues`      — { framework, testids, components, ids, labels, classes, bundles, api }
- `sourceHints`— { frontend: [...], backend: [...] }
- `fileHints`  — candidate file glob/grep patterns
- `target`     — { mode: 'local'|'proxy', url, repoRoot }
