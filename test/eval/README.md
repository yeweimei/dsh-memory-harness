# LongMemEval retrieval evaluation

This benchmark evaluates the plugin's **retrieval layer** against LongMemEval oracle sessions. It does not run extraction, admission, or a QA reader.

## Dataset

Download the cleaned oracle file from Hugging Face:

```bash
mkdir -p test/eval/data
cd test/eval/data
wget https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_oracle.json
```

The dataset is not committed (`.gitignore` excludes `test/eval/data/*.json`).

## Run

The evaluation uses the same embedding endpoint as the plugin. Set the key if your endpoint requires one:

```bash
export DSH_MEMORY_API_KEY='...'
npm run eval:longmemeval -- --limit 50 --seed 42 --out test/eval/results/longmemeval-oracle-50.json
```

Optional flags:

| Flag | Default | Meaning |
|---|---|---|
| `--limit` | 50 | number of questions, stratified across question types |
| `--seed` | 42 | deterministic sample seed |
| `--k` | `5,10` | recall cutoffs |
| `--base-url` | `http://127.0.0.1:7000/v1` | embedding endpoint |
| `--model` | `Qwen3-embedding-0.6B` | embedding model |
| `--dimensions` | 1024 | embedding width |
| `--batch-size` | 4 | embedding batch size |
| `--max-chars` | 1000 | per-turn text cap before embedding |
| `--include-abstention` | false | include LongMemEval abstention questions |
| `--granularity` | `turn` | `turn` (default) or `session`; session is much cheaper on a CPU embedding server |

## What is measured

For `--granularity turn`, each oracle turn is stored as a session-scoped memory. For `--granularity session`, one memory contains the whole session (truncated by `--max-chars`) and only session-level recall is reported. For each question:

- **session recall@k**: a retrieved turn belongs to an `answer_session_ids` session;
- **turn recall@k**: a retrieved turn has `has_answer: true`;
- **MRR**: reciprocal rank of the first relevant turn;
- **nDCG@k**: binary-gain ranking quality.

Abstention questions are excluded by default, matching LongMemEval's retrieval convention.

## Baseline result (oracle, 50 questions, turn granularity)

Run on 2026-11-19 with `seed=42`, local Qwen3-embedding-0.6B (1024d):

```text
session recall@5/10: 100.0% / 100.0%   MRR 100.0%   nDCG@10 100.0%
turn    recall@5/10:  88.0% /  98.0%   MRR  74.9%   nDCG@10  78.8%
```

Per type, session recall@10 was 100% across knowledge-update, multi-session, single-session-assistant, single-session-preference, single-session-user, and temporal-reasoning. The only turn-level miss was one preference question whose answer turn ranked outside the top 10.

## End-to-end results

The end-to-end harness adds an LLM reader and LLM judge on top of retrieval. It uses `qwen3.6-35b-a3b-mtp` at `127.0.0.1:7000/v1` as both reader and judge; thinking is disabled for the judge and enabled for the reader.

| Run | Questions | Retrieval hit@10 | Accuracy | Notes |
|---|---:|---:|---:|---|
| Oracle, turn granularity | 20 | 100% | **70.0%** | oracle history only; reader median ~30s |
| S, chunk granularity | 12 (10 normal + 2 abs) | 100% | **66.7%** | normal 60.0%, abstention 100%; reader median ~36s |

Oracle turn-level heuristics: exact 35%, contains 65%, token-F1 0.653.  
S chunk-level heuristics: exact 25%, contains 33.3%, token-F1 0.393.

Both runs use an isolated temporary SQLite directory and never open `~/.dsh/memory/memory.db`. Results are in `test/eval/results/` (gitignored).

## Baseline result (LongMemEval-S, 50 questions, session granularity)

Run on 2026-11-19 with `seed=42`, local Qwen3-embedding-0.6B (1024d), 2405 sessions:

```text
session recall@5/10: 92.0% / 96.0%   MRR 82.5%   nDCG@10 85.5%
```

Per type (session recall@10): knowledge-update 87.5%, multi-session 100%, single-session-assistant 100%, single-session-preference 100%, single-session-user 88.9%, temporal-reasoning 100%.

Compared with oracle, the S run adds ~50x more distractor sessions: session recall@10 drops from 100% to 96%, MRR from 100% to 82.5%. The two session-level misses were a single-session-user discount fact and a knowledge-update grocery-list question.

## End-to-end commands

```bash
export LONGMEMEVAL_LLM_API_KEY='...'
export LONGMEMEVAL_EMBEDDING_API_KEY='...'

# oracle, turn granularity
npm run eval:longmemeval:e2e -- \
  --data test/eval/data/longmemeval_oracle.json \
  --limit 20 --granularity turn --top-k 10 --max-chars 1000 \
  --out test/eval/results/longmemeval-oracle-e2e-turn-20.json

# S, chunk granularity
npm run eval:longmemeval:e2e -- \
  --data test/eval/data/longmemeval_s_cleaned.json \
  --limit 10 --abstention-limit 2 --granularity chunk \
  --top-k 10 --max-chars 1500 \
  --out test/eval/results/longmemeval-s-e2e-chunk-12.json
```

The reader/judge API key is read from `LONGMEMEVAL_LLM_API_KEY`; the embedding key from `LONGMEMEVAL_EMBEDDING_API_KEY` or `DSH_MEMORY_API_KEY`. No key is written to the report or repository.

## LongMemEval-S note

`longmemeval_s_cleaned.json` has about 48 sessions / 494 turns per question. A 50-question turn-level run needs ~25k embedding calls; with the local CPU Qwen endpoint that is impractically slow. Use `--granularity session` for the first S run, or use a GPU/remote embedding endpoint for turn-level.

```bash
npm run eval:longmemeval -- \
  --data test/eval/data/longmemeval_s_cleaned.json \
  --limit 50 --granularity session --batch-size 8 --max-chars 2000 \
  --out test/eval/results/longmemeval-s-50-session.json
```

## Caveats

- Oracle only contains evidence sessions, so it is an **easy upper-ish baseline**, not a leaderboard-comparable result.
- This tests retrieval over raw turns, not the plugin's extraction/admission quality.
- Next runs should use `longmemeval_s_cleaned.json` (40 sessions/question) or a larger `m` sample.
- Compare retrieval modes and configuration changes on the same sample/seed; do not compare directly to published paper numbers.
