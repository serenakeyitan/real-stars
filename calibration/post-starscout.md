# real-stars calibration report

Generated: 2026-05-09T08:17:04.336Z

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
| [torvalds/linux](https://github.com/torvalds/linux) | 232,507 | 0 | 0/0/0 | 0.9% | low | organic | ✅ | Linus Torvalds' Linux kernel — most legitimate repo on GitHub |
| [microsoft/vscode](https://github.com/microsoft/vscode) | 184,719 | 0 | 0/0/0 | 1.3% | low | organic | ✅ | Microsoft VS Code — popular real-world product, heavily used |
| [kubernetes/kubernetes](https://github.com/kubernetes/kubernetes) | 122,147 | 0 | 0/0/0 | 0.7% | low | organic | ✅ | Kubernetes — battle-tested CNCF project |
| [facebook/react](https://github.com/facebook/react) | 244,886 | 0 | 0/0/0 | 2.6% | low | organic | ✅ | React — Meta's flagship UI framework |
| [denoland/deno](https://github.com/denoland/deno) | 106,622 | 0 | 0/0/0 | 0.5% | low | organic | ✅ | Deno — legitimate viral spikes from HN/Twitter |
| [vercel/next.js](https://github.com/vercel/next.js) | 139,335 | 0 | 0/0/0 | 1.9% | low | organic | ✅ | Next.js — popular framework |
| [rust-lang/rust](https://github.com/rust-lang/rust) | 112,627 | 0 | 0/0/0 | 0.5% | low | organic | ✅ | Rust language — slow steady organic growth |
| [anthropics/claude-code](https://github.com/anthropics/claude-code) | 121,840 | 5,000 | 0/0/0 | 0.0% | low | organic | ✅ | analyzed 5000 of 121840 |
| [openai/openai-python](https://github.com/openai/openai-python) | 30,721 | 0 | 0/0/0 | 1.0% | low | organic | ✅ | Official OpenAI SDK |
| [huggingface/transformers](https://github.com/huggingface/transformers) | 160,407 | 0 | 0/0/0 | 1.4% | low | organic | ✅ | HF Transformers — established ML library |
| [LupusLeaks/EasyFN](https://github.com/LupusLeaks/EasyFN) | 6,869 | 0 | 0/0/0 | 83.5% | high | fake-suspect | ✅ | StarScout suspicious — 6,869 stars (only ≥1000-star fake-suspect still on GitHub) |
