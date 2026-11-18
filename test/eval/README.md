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

## What is measured

Each oracle turn is stored as a session-scoped memory. For each question:

- **session recall@k**: a retrieved turn belongs to an `answer_session_ids` session;
- **turn recall@k**: a retrieved turn has `has_answer: true`;
- **MRR**: reciprocal rank of the first relevant turn;
- **nDCG@k**: binary-gain ranking quality.

Abstention questions are excluded by default, matching LongMemEval's retrieval convention.

## Baseline result (oracle, 50 questions)

Run on 2026-11-19 with `seed=42`, local Qwen3-embedding-0.6B (1024d):

```text
session recall@5/10: 100.0% / 100.0%   MRR 100.0%   nDCG@10 100.0%
turn    recall@5/10:  88.0% /  98.0%   MRR  74.9%   nDCG@10  78.8%
```

Per type, session recall@10 was 100% across knowledge-update, multi-session, single-session-assistant, single-session-preference, single-session-user, and temporal-reasoning. The only turn-level miss was one preference question whose answer turn ranked outside the top 10.

## Caveats

- Oracle only contains evidence sessions, so it is an **easy upper-ish baseline**, not a leaderboard-comparable result.
- This tests retrieval over raw turns, not the plugin's extraction/admission quality.
- Next runs should use `longmemeval_s_cleaned.json` (40 sessions/question) or a larger `m` sample.
- Compare retrieval modes and configuration changes on the same sample/seed; do not compare directly to published paper numbers.
