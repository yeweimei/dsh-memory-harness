# Changelog

## 0.19.2

- Remove the credential-reading manual RPC verifier from the public repository so the plugin-market security scan has no credential-access surface.
- Keep browser verification as a documented manual GUI step only.

## 0.19.1

- Fix vector index invalidation after embedding settings changes: re-index persisted vectors when they still match the configured model/dimensions, and only mark mismatched records as pending.
- Add a “Rebuild vector index” action in diagnostics; no embedding calls are made when stored vectors are usable.
- Clarify that pending vectors do not mean data loss.

## 0.19.0

Release preparation.

- Add CI workflow for syntax checks, tests and `npm pack --dry-run`.
- Add npm scripts (`test`, `pack:check`), `engines.dsh`, changelog and release checklist.
- Update README to schema v7, LLM conflict judgment, proactive recall, data/privacy notes and known limitations.
- Add repository `.gitignore` rules so local databases, backups and tarballs are never committed.
- Add npm repository/homepage/bugs/author metadata for `yeweimei/dsh-memory-harness`.

## 0.18.1

- Add a collapsible “Advanced / conflict judge” settings section for review confidence, candidate count, timeout and contradiction policy.

## 0.18.0

- Replace similarity-only conflict detection with an LLM judge: similarity shortlists candidates, the model returns `supersede` / `update` / `contradict` / `duplicate` / `compatible` / `unrelated` with confidence and evidence.
- High-confidence `supersede`/`update`/`duplicate` actions apply automatically and remain rollbackable via revisions; contradictions default to human review.
- LLM failures fall back to the heuristic similarity check.
- Conflict review cards show relation, confidence, reason and evidence.

## 0.17.1

- Add possible-conflict detection and a review UI for old/new versions of the same fact.
- Add optional `validUntil` on memories; expired memories enter human review instead of disappearing.
- Add `keep`/replace/ignore conflict actions.

## 0.17.0

- Add expiry sweep and conflict review cards.
- Persist effective `validUntil` through the tool and panel add form.

## 0.16.0

- Add first-turn proactive recall: after the first user message, inject only memories above the configured similarity threshold and record them for rating.
- Add proactive recall settings.

## 0.15.0

- Split recall feedback into relevance (contextual) and content (outdated/incorrect/duplicate) axes.
- Store query embeddings for context-conditioned reranking; do not globally penalize a memory for being irrelevant in one conversation.
- Content-quality review queue and `qualityScore`.

## 0.14.0

- Feedback-driven memory review: repeated content issues queue memories for human review.
- Add review tab with edit/keep/archive actions.

## 0.13.x

- Recall review tray with five-level ratings.
- Reviewed recall groups are temporary and do not reappear after submit.
- Undo window, submit animation, floating panel and local cleanup.
- Recall quality charts and daily snapshots.

## Earlier

- 0.12.0 and earlier: on-demand capture, rule/LLM extraction and automatic admission, hybrid retrieval, SQLite/FTS5/graph, session-start injection, failure hints, panel, diagnostics, backups, import/export, history/rollback.
