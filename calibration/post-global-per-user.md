# real-stars calibration report

Generated: 2026-05-10T02:43:16.375Z

## Summary

- ✅ Agree:        **3** / 11
- ❌ Disagree:     **0** / 11
- ⚪ Inconclusive: 8 / 11
- ⚠️ Errored:      8 / 11

A "match" means the algorithm agreed with the curated expectation:

| Expected      | Algorithm risk          | Match     |
| ------------- | ----------------------- | --------- |
| organic       | low                     | agree     |
| organic       | medium / high           | disagree  |
| fake-suspect  | medium / high           | agree     |
| fake-suspect  | low                     | disagree  |
| unknown       | (any)                   | inconclusive |

## Details

| Repo | Stars | Analyzed | Bursts (org/sus/fake) | Suspicious % | Risk | Expected | Match | Notes |
| ---- | ----- | -------- | --------------------- | ------------ | ---- | -------- | ----- | ----- |
| [torvalds/linux](https://github.com/torvalds/linux) | 232,592 | 5,000 | 1/0/0 | 1.5% | low | organic | ✅ | analyzed 5000 of 232592 |
| [microsoft/vscode](https://github.com/microsoft/vscode) | 184,734 | 5,000 | 1/0/0 | 1.5% | low | organic | ✅ | analyzed 5000 of 184734 |
| [kubernetes/kubernetes](https://github.com/kubernetes/kubernetes) | 122,158 | 5,000 | 0/0/1 | 1.6% | low | organic | ✅ | analyzed 5000 of 122158 |
| [facebook/react](https://github.com/facebook/react) | — | — | — | — | — | organic | ⚠️ | error: `repo metadata: 403 Forbidden` |
| [denoland/deno](https://github.com/denoland/deno) | — | — | — | — | — | organic | ⚠️ | error: `repo metadata: 403 Forbidden` |
| [vercel/next.js](https://github.com/vercel/next.js) | — | — | — | — | — | organic | ⚠️ | error: `repo metadata: 403 Forbidden` |
| [rust-lang/rust](https://github.com/rust-lang/rust) | — | — | — | — | — | organic | ⚠️ | error: `repo metadata: 403 Forbidden` |
| [anthropics/claude-code](https://github.com/anthropics/claude-code) | — | — | — | — | — | organic | ⚠️ | error: `repo metadata: 403 Forbidden` |
| [openai/openai-python](https://github.com/openai/openai-python) | — | — | — | — | — | organic | ⚠️ | error: `repo metadata: 403 Forbidden` |
| [huggingface/transformers](https://github.com/huggingface/transformers) | — | — | — | — | — | organic | ⚠️ | error: `repo metadata: 403 Forbidden` |
| [LupusLeaks/EasyFN](https://github.com/LupusLeaks/EasyFN) | — | — | — | — | — | fake-suspect | ⚠️ | error: `repo metadata: 403 Forbidden` |
