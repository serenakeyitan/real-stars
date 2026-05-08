# real-stars calibration report

Generated: 2026-05-08T23:13:04.397Z

## Summary

- ✅ Agree:        **8** / 11
- ❌ Disagree:     **3** / 11
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
| [torvalds/linux](https://github.com/torvalds/linux) | 232,470 | 1,500 | 0/0/0 | 0.0% | low | organic | ✅ | analyzed 1500 of 232470 |
| [microsoft/vscode](https://github.com/microsoft/vscode) | 184,710 | 1,500 | 0/0/0 | 0.0% | low | organic | ✅ | analyzed 1500 of 184710 |
| [kubernetes/kubernetes](https://github.com/kubernetes/kubernetes) | 122,139 | 1,500 | 0/0/0 | 0.0% | low | organic | ✅ | analyzed 1500 of 122139 |
| [facebook/react](https://github.com/facebook/react) | 244,878 | 1,500 | 0/0/0 | 0.0% | low | organic | ✅ | analyzed 1500 of 244878 |
| [denoland/deno](https://github.com/denoland/deno) | 106,615 | 1,500 | 0/0/0 | 0.0% | low | organic | ✅ | analyzed 1500 of 106615 |
| [vercel/next.js](https://github.com/vercel/next.js) | 139,335 | 1,500 | 0/0/1 | 46.0% | high | organic | ❌ | analyzed 1500 of 139335 |
| [rust-lang/rust](https://github.com/rust-lang/rust) | 112,625 | 1,500 | 0/1/1 | 42.8% | high | organic | ❌ | analyzed 1500 of 112625 |
| [anthropics/claude-code](https://github.com/anthropics/claude-code) | 121,679 | 1,500 | 0/0/0 | 0.0% | low | organic | ✅ | analyzed 1500 of 121679 |
| [openai/openai-python](https://github.com/openai/openai-python) | 30,715 | 1,415 | 5/0/0 | 0.0% | low | organic | ✅ | Official OpenAI SDK |
| [huggingface/transformers](https://github.com/huggingface/transformers) | 160,403 | 1,500 | 0/0/0 | 0.0% | low | organic | ✅ | analyzed 1500 of 160403 |
| [LupusLeaks/EasyFN](https://github.com/LupusLeaks/EasyFN) | 6,869 | 1,469 | 1/1/0 | 0.2% | low | fake-suspect | ❌ | StarScout suspicious — 6,869 stars (only ≥1000-star fake-suspect still on GitHub) |
