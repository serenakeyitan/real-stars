# real-stars calibration report

Generated: 2026-05-10T02:27:44.323Z

## Summary

- ✅ Agree:        **11** / 11
- ❌ Disagree:     **0** / 11
- ⚪ Inconclusive: 0 / 11

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
| [torvalds/linux](https://github.com/torvalds/linux) | 232,593 | 5,000 | 1/0/0 | 0.0% | low | organic | ✅ | analyzed 5000 of 232593 |
| [microsoft/vscode](https://github.com/microsoft/vscode) | 184,734 | 5,000 | 1/0/0 | 0.0% | low | organic | ✅ | analyzed 5000 of 184734 |
| [kubernetes/kubernetes](https://github.com/kubernetes/kubernetes) | 122,158 | 5,000 | 1/0/0 | 0.0% | low | organic | ✅ | analyzed 5000 of 122158 |
| [facebook/react](https://github.com/facebook/react) | 244,902 | 5,000 | 1/0/0 | 0.0% | low | organic | ✅ | analyzed 5000 of 244902 |
| [denoland/deno](https://github.com/denoland/deno) | 106,629 | 5,000 | 3/0/0 | 0.0% | low | organic | ✅ | analyzed 5000 of 106629 |
| [vercel/next.js](https://github.com/vercel/next.js) | 139,345 | 5,000 | 1/0/0 | 0.0% | low | organic | ✅ | analyzed 5000 of 139345 |
| [rust-lang/rust](https://github.com/rust-lang/rust) | 112,645 | 5,000 | 6/0/0 | 0.0% | low | organic | ✅ | analyzed 5000 of 112645 |
| [anthropics/claude-code](https://github.com/anthropics/claude-code) | 122,049 | 5,000 | 0/0/0 | 0.0% | low | organic | ✅ | analyzed 5000 of 122049 |
| [openai/openai-python](https://github.com/openai/openai-python) | 30,731 | 4,931 | 6/0/1 | 0.1% | low | organic | ✅ | Official OpenAI SDK |
| [huggingface/transformers](https://github.com/huggingface/transformers) | 160,425 | 5,000 | 2/0/0 | 0.0% | low | organic | ✅ | analyzed 5000 of 160425 |
| [LupusLeaks/EasyFN](https://github.com/LupusLeaks/EasyFN) | 6,869 | 4,969 | 0/1/1 | 60.8% | high | fake-suspect | ✅ | StarScout suspicious — 6,869 stars (only ≥1000-star fake-suspect still on GitHub) |
