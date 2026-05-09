# real-stars calibration report

Generated: 2026-05-09T00:02:17.204Z

## Summary

- ✅ Agree:        **10** / 11
- ❌ Disagree:     **1** / 11
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
| [torvalds/linux](https://github.com/torvalds/linux) | 232,474 | 5,000 | 0/0/1 | 0.3% | low | organic | ✅ | analyzed 5000 of 232474 |
| [microsoft/vscode](https://github.com/microsoft/vscode) | 184,711 | 5,000 | 0/0/1 | 0.8% | low | organic | ✅ | analyzed 5000 of 184711 |
| [kubernetes/kubernetes](https://github.com/kubernetes/kubernetes) | 122,139 | 5,000 | 0/0/1 | 0.8% | low | organic | ✅ | analyzed 5000 of 122139 |
| [facebook/react](https://github.com/facebook/react) | 244,879 | 5,000 | 0/0/1 | 0.6% | low | organic | ✅ | analyzed 5000 of 244879 |
| [denoland/deno](https://github.com/denoland/deno) | 106,615 | 5,000 | 0/0/3 | 2.8% | low | organic | ✅ | analyzed 5000 of 106615 |
| [vercel/next.js](https://github.com/vercel/next.js) | 139,336 | 5,000 | 0/0/1 | 0.6% | low | organic | ✅ | analyzed 5000 of 139336 |
| [rust-lang/rust](https://github.com/rust-lang/rust) | 112,626 | 5,000 | 0/3/3 | 0.8% | low | organic | ✅ | analyzed 5000 of 112626 |
| [anthropics/claude-code](https://github.com/anthropics/claude-code) | 121,688 | 5,000 | 0/0/0 | 0.0% | low | organic | ✅ | analyzed 5000 of 121688 |
| [openai/openai-python](https://github.com/openai/openai-python) | 30,715 | 4,915 | 6/0/1 | 1.2% | low | organic | ✅ | Official OpenAI SDK |
| [huggingface/transformers](https://github.com/huggingface/transformers) | 160,403 | 5,000 | 0/0/2 | 0.8% | low | organic | ✅ | analyzed 5000 of 160403 |
| [LupusLeaks/EasyFN](https://github.com/LupusLeaks/EasyFN) | 6,869 | 4,969 | 1/1/0 | 0.0% | low | fake-suspect | ❌ | StarScout suspicious — 6,869 stars (only ≥1000-star fake-suspect still on GitHub) |
