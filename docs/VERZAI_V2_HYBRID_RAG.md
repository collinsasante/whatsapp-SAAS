# VerzAI v2 hybrid retrieval (keyword + vector)

Status: the retrieval engine, chunker, fusion, reranker, vector store, indexer and a local embedding adapter (`local-minilm`) are built and
tested. It is **off** and **idle** in this build: `RAG_HYBRID_ENABLED` is unset, the model files and `onnxruntime-web` are not in any image, and
the stock `postgres:16-alpine` image has no pgvector. Until all of that is provided and approved, retrieval is exactly the keyword retrieval the
pipeline used before. Nothing has been deployed, migrated or indexed anywhere.

## Flow (one customer message)

1. `ContextAssemblyStage` asks the bound `KnowledgeContextSource` for context (interface unchanged; `getContextWithTrace` is an optional
   addition that also reports which articles were used).
2. `HybridKnowledgeContextSource` -> `HybridRetriever.retrieve(tenantId, query, previousCustomerMessages)`:
   - load the tenant's active articles (tenant-scoped);
   - **keyword** candidates: the existing `buildRetrievalQuery` + `scoreArticles` (stemming, synonyms, IDF, title boost);
   - **vector** candidates: embed the query (`kind: 'query'`), `VectorStore.search(tenantId, ...)`, drop hits below `RAG_MIN_VECTOR_SCORE`;
   - fuse with **reciprocal rank fusion** (`hybrid-fusion.ts`); rerank with `LexicalReranker` (term coverage, title, phrase match,
     similarity, then maximal-marginal-relevance for diversity); cap at 5 articles / 6000 characters, as before;
   - for a long article, only its matching chunks are passed on.
3. The text is the same "KNOWLEDGE BASE:" block plus the approved-corrections guidance, rendered into `{{knowledge_base}}`.
4. The trace (article ids, titles, ranks, scores, mode, fallback reason; never content) is stored in the execution's `safetyFlags.retrieval`.

## Fallback

The vector side is skipped, and the result is **identical to keyword-only retrieval**, whenever: no provider is configured, no store, the
provider or store errors or returns a wrong-sized vector, the vector side exceeds `RAG_VECTOR_TIMEOUT_MS`, the tenant has no index, or no chunk
clears the similarity threshold. The reason is in `trace.fallbackReason`. A knowledge base of 5 articles or fewer is passed whole, as before.

## Tenant isolation

Articles come from a tenant-scoped loader. `VectorStore.search` takes the tenant and filters on it. The SQL joins the article table on id AND tenant,
requires `is_active`, and ignores a chunk whose `md5(title || '\n' || content)` no longer matches (edited article => old vectors unused until
re-indexed). Writes are `INSERT ... SELECT FROM knowledge_base_articles WHERE id = $a AND tenant_id = $t AND md5(...) = $hash`, so a tenant cannot
store a chunk for another tenant's article. The retriever additionally drops any hit whose tenant differs or whose article is not in the tenant's
active list. All covered by tests, including the SQL against a real pgvector database.

## Configuration (all optional)

| Variable | Default | Meaning |
|---|---|---|
| `RAG_HYBRID_ENABLED` | unset (off) | exactly `true` binds the hybrid source |
| `EMBEDDING_PROVIDER` | unset | adapter name (`local-minilm`); a name with no adapter in the build fails at start-up |
| `EMBEDDING_MODEL_DIR` | unset | directory with the pinned MiniLM files (see below); only read by `local-minilm` |
| `RAG_MIN_VECTOR_SCORE` | 0.35, or the provider's own (0.25 for `local-minilm`) | minimum cosine similarity; setting it always wins |
| `RAG_VECTOR_TIMEOUT_MS` | 800 | give up on the vector side after this long |
| `RAG_VECTOR_WEIGHT` / `RAG_KEYWORD_WEIGHT` / `RAG_RRF_K` | 1 / 1 / 60 | fusion |
| `RAG_VECTOR_CANDIDATES` / `RAG_KEYWORD_CANDIDATES` / `RAG_MAX_CHUNKS_PER_ARTICLE` | 12 / 12 / 2 | candidate pools |

Chunking (`semantic-chunker.ts`): `targetChars` 800, `maxChars` 1200, `overlapChars` 120, `minChars` 150; passed to `KnowledgeIndexer`.

## The local embedding adapter (`local-minilm`)

`src/knowledge-base/rag/local-minilm/`: all-MiniLM-L6-v2 (int8) run **in-process** with ONNX Runtime Web (WebAssembly). No hosted API, no extra
service. The native `onnxruntime-node` binary cannot load on the backend's `node:20-alpine` (musl) image; WebAssembly can.

- `wordpiece-tokenizer.ts`: BERT-uncased WordPiece built from the model's `tokenizer.json`; no tokenizer dependency. Checked token-for-token against
  the reference tokenizer (20 cases: accents, CJK, emoji, control characters, punctuation, long words, truncation).
- `minilm-embedding-provider.ts`: attention mask (1 for tokens, 0 for padding), mean pooling over real tokens, L2 normalisation, output-shape and
  NaN checks, one inference lane (calls queue; more than 32 waiting fails fast), and a retry back-off after a failed load.
  **One text per inference call**: with the int8 model a text embedded inside a batch differs by up to ~1% (cosine 0.99) from the same text alone, so
  batching would make a stored vector depend on which articles were indexed with it. One at a time is deterministic (cosine 1.0000) and was faster.
- `minilm-loader.ts`: loads from `EMBEDDING_MODEL_DIR` only (no download), refuses files whose SHA-256 differs from the pinned ones, loads once and keeps
  the session. `onnxruntime-web` is resolved with `require` at first use, so a build without it starts normally and reports the provider unavailable.
- Registered in `embedding-adapters.ts`; started (warm-up, in the background) only when `RAG_HYBRID_ENABLED=true`.
- Every failure (files or runtime missing, hash mismatch, bad output, timeout, overload) is an exception, and the retriever returns the keyword result.

Vectors are stored with the model identity `Xenova/all-MiniLM-L6-v2@751bff3:int8`; vectors of other models are never compared with them.

### Model files and licence

Not in the repository and not in any image. Apache-2.0 text and attribution: `apps/backend/third-party/all-MiniLM-L6-v2/` (`LICENSE`, `NOTICE.md`).
**The training-data provenance of the model is not verified** (the publisher lists ~1 billion pairs from many public datasets; we have not audited those
datasets' terms). `NOTICE.md` states this; it is an open compliance decision, not something the code or tests settle.

Pinned files (Xenova/all-MiniLM-L6-v2 @ `751bff37182d3f1213fa05d7196b954e230abad9`), placed under `EMBEDDING_MODEL_DIR`:

| File | Bytes | SHA-256 |
|---|---|---|
| `tokenizer.json` | 711,661 | `da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0` |
| `onnx/model_quantized.onnx` | 22,972,370 | `afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1` |

### Measured on the backend's base image

`node:20-alpine` (Alpine 3.23, Node 20.20.2, musl, arm64) in a container limited to 1 GB and 2 CPUs, real model, two runs (the VM is shared with other
containers, so latency varies run to run):

| | Result |
|---|---|
| Resident memory | Node alone ~39 MB; ~390-400 MB once the model is loaded; **peak 532-597 MB** (container cgroup peak 513-576 MB) |
| Model load | 0.5-0.6 s (once, in the background at start-up) |
| Query embedding | p50 10-22 ms, p95 34-45 ms |
| Passage embedding (indexing) | p50 ~20 ms, p95 ~30 ms; 60 passages in ~1.2 s |
| CPU | one core fully busy while embedding |

Embedding runs on the event-loop thread (single-threaded WebAssembly), so each query delays other requests in that backend process by its own duration
(tens of milliseconds), and indexing delays them for as long as it runs: index a large knowledge base off-peak. A deployment needs ~600 MB of memory headroom
in the backend container on top of what it uses today. Staging and production headroom has NOT been checked (the read-only inspection script still has to be run on the server).

Retrieval quality on the 30-article / 45-query synthetic set (real `PgVectorStore`, threshold 0.25): top-3 hit rate 69% (keyword only) -> 90% (hybrid);
paraphrased questions 48% -> 81%. Known misses remain (for example "do you bring a cake to my house" scores 0.13 against the delivery article), which is
why keyword retrieval stays in the fusion. The set is small and synthetic; treat differences of a few points as noise and re-measure on real, approved data.

## What is still needed before it can run in an environment

1. **Approval to add the runtime and model.** `onnxruntime-web@1.31.1` (MIT; its package is ~145 MB on disk, of which only one `.wasm` and the Node loader are
   needed, so it can be trimmed) is **deliberately not in `package.json`** yet, and the model files must be placed on the host (volume mount) and pointed to by
   `EMBEDDING_MODEL_DIR`. Until then the adapter reports itself unavailable and retrieval is keyword-only.
2. **pgvector in the database image.** `infra/postgres/Dockerfile` builds `postgres:16-alpine` + pgvector (not wired into any compose file; pin `PG_IMAGE`
   to the production minor version and smoke-test it on the server's architecture first). Production, staging and dev use stock `postgres:16-alpine` today.
   The table is deliberately **not** a Prisma migration (it would fail `prisma migrate deploy` on databases without the extension). Apply it with
   `ensurePgVectorSchema` once the image has pgvector.
3. **Indexing is explicit.** `KnowledgeIndexer.indexTenant(tenantId, { dryRun })` is never called automatically; existing knowledge-base rows are never
   modified. `dryRun` reports chunk and rough token counts with no provider. Indexing runs on the event-loop thread (~20 ms per chunk), so index a large
   knowledge base off-peak.
4. **Acceptance of the licence/provenance position** above.

## Testing

`pnpm --filter @whatsapp-platform/backend exec jest src/knowledge-base/rag src/ai-core/pipeline` runs everything except the pgvector SQL suite.
That suite (`pgvector-store.integration.spec.ts`) runs only when `RAG_TEST_DATABASE_URL` points at an isolated database that has the pgvector extension
and the application schema; it is skipped otherwise.

The real-model tests (`local-minilm/*.integration.spec.ts`, and the model-backed cases in `wordpiece-tokenizer.spec.ts`) are skipped unless
`EMBEDDING_MODEL_DIR` is set and `onnxruntime-web` resolves (for example `NODE_PATH=/path/to/node_modules`). Jest also needs
`NODE_OPTIONS=--experimental-vm-modules` for them, because onnxruntime-web loads its WebAssembly with a dynamic `import()`; plain Node does not.
With `RAG_TEST_DATABASE_URL` as well, they index a fixture knowledge base through `KnowledgeIndexer` into pgvector and retrieve through `HybridRetriever`.
