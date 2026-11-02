# all-MiniLM-L6-v2 — attribution and provenance

The `local-minilm` embedding adapter (`src/knowledge-base/rag/local-minilm/`) runs the **all-MiniLM-L6-v2** sentence-embedding model.
**The model files are not part of this repository or of any image built from it.** They are fetched separately onto the host and
selected with `EMBEDDING_MODEL_DIR` (see `docs/VERZAI_V2_HYBRID_RAG.md`). This notice and the licence text beside it are the notices to ship
with the model wherever it is deployed.

## What is used

| Item | Source | Licence as declared by its publisher |
|---|---|---|
| all-MiniLM-L6-v2 (original weights) | https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2 — Nils Reimers, Iryna Gurevych and the sentence-transformers contributors | Apache License 2.0 (`license: apache-2.0` in the model card metadata) |
| ONNX int8 export used here (`onnx/model_quantized.onnx`, `tokenizer.json`) | https://huggingface.co/Xenova/all-MiniLM-L6-v2 at revision `751bff37182d3f1213fa05d7196b954e230abad9` — a conversion of the model above by Hugging Face / Xenova | Apache License 2.0 (`license: apache-2.0`) |
| onnxruntime-web 1.31.1 (not yet a dependency of this package) | https://www.npmjs.com/package/onnxruntime-web — Microsoft | MIT |

The exact files are pinned by SHA-256 in `src/knowledge-base/rag/local-minilm/minilm-loader.ts`; a file that does not match is refused.

## Apache-2.0 obligations this notice is meant to meet

- The licence text is in `LICENSE` in this directory and must accompany any copy of the model files that is redistributed.
- Attribution above must be kept. Neither publisher endorses this product.
- **Changes made to the original:** the weights were converted to ONNX and quantised to int8 by the Xenova export (not by us). We made no further change to the weights. The tokenizer is re-implemented in TypeScript (`wordpiece-tokenizer.ts`) and checked against the reference tokenizer; that is our code, not part of the model.
- The upstream repositories ship no `NOTICE` file, so there is no upstream NOTICE text to reproduce. Re-check this when the pinned revision changes.

## Training-data provenance: NOT verified

The publisher's model card states that the model was fine-tuned on "above 1 billion" sentence pairs concatenated from many public datasets
(it lists, among others, Reddit comments 2015–2018, S2ORC citation pairs, WikiAnswers duplicate questions and PAQ), starting from the
pretrained `nreimers/MiniLM-L6-H384-uncased`.

- The Apache-2.0 licence covers the weights as published by the authors. It does **not** by itself establish that the licences or terms of
  every training dataset permit commercial use of a model trained on them, and we have **not** audited those datasets, their terms, or the
  licence chain of the pretrained base model.
- Nothing in this repository, its documentation or its tests claims otherwise. Treat the training-data question as an open legal/compliance
  item to be accepted or reviewed by the business before the model is enabled in production.
- The model is used only to turn text into vectors for search. It does not generate text, and no customer data is sent to its publishers:
  inference runs in-process and offline.

## Known limitations of the model (measured, not legal)

English-centred (the multilingual variants were evaluated and were weaker or heavier); inputs are truncated at 256 tokens; some everyday
paraphrases score low (for example "do you bring a cake to my house" against a delivery article scored 0.13). Keyword retrieval stays in the
pipeline for this reason.
