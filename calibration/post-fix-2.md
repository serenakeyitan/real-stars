# real-stars calibration report

Generated: 2026-05-06T19:41:19.206Z

## Summary

- ✅ Agree: **13** / 26
- ❌ Disagree: **13** / 26
- ⚪ Inconclusive: 0 / 26

A "match" means the algorithm agreed with the curated expectation:

| Expected     | Algorithm risk | Match        |
| ------------ | -------------- | ------------ |
| organic      | low            | agree        |
| organic      | medium / high  | disagree     |
| fake-suspect | medium / high  | agree        |
| fake-suspect | low            | disagree     |
| unknown      | (any)          | inconclusive |

## Details

| Repo                                                                                                                    | Stars   | Analyzed | Bursts (org/sus/fake) | Suspicious % | Risk   | Expected     | Match | Notes                                                                   |
| ----------------------------------------------------------------------------------------------------------------------- | ------- | -------- | --------------------- | ------------ | ------ | ------------ | ----- | ----------------------------------------------------------------------- |
| [torvalds/linux](https://github.com/torvalds/linux)                                                                     | 232,181 | 1,500    | 0/0/0                 | 0.0%         | low    | organic      | ✅    | analyzed 1500 of 232181                                                 |
| [microsoft/vscode](https://github.com/microsoft/vscode)                                                                 | 184,616 | 1,500    | 0/0/0                 | 0.0%         | low    | organic      | ✅    | analyzed 1500 of 184616                                                 |
| [kubernetes/kubernetes](https://github.com/kubernetes/kubernetes)                                                       | 122,088 | 1,500    | 0/0/0                 | 0.0%         | low    | organic      | ✅    | analyzed 1500 of 122088                                                 |
| [facebook/react](https://github.com/facebook/react)                                                                     | 244,834 | 1,500    | 0/0/0                 | 0.0%         | low    | organic      | ✅    | analyzed 1500 of 244834                                                 |
| [denoland/deno](https://github.com/denoland/deno)                                                                       | 106,607 | 1,500    | 0/0/0                 | 0.0%         | low    | organic      | ✅    | analyzed 1500 of 106607                                                 |
| [vercel/next.js](https://github.com/vercel/next.js)                                                                     | 139,300 | 1,500    | 0/0/1                 | 46.4%        | high   | organic      | ❌    | analyzed 1500 of 139300                                                 |
| [rust-lang/rust](https://github.com/rust-lang/rust)                                                                     | 112,573 | 1,500    | 0/1/1                 | 42.8%        | high   | organic      | ❌    | analyzed 1500 of 112573                                                 |
| [anthropics/claude-code](https://github.com/anthropics/claude-code)                                                     | 120,961 | 1,500    | 0/0/0                 | 0.0%         | low    | organic      | ✅    | analyzed 1500 of 120961                                                 |
| [openai/openai-python](https://github.com/openai/openai-python)                                                         | 30,697  | 1,496    | 7/0/0                 | 0.0%         | low    | organic      | ✅    | Official OpenAI SDK — real demand-driven growth                         |
| [huggingface/transformers](https://github.com/huggingface/transformers)                                                 | 160,308 | 1,500    | 0/0/0                 | 0.0%         | low    | organic      | ✅    | analyzed 1500 of 160308                                                 |
| [LupusLeaks/EasyFN](https://github.com/LupusLeaks/EasyFN)                                                               | 6,869   | 1,469    | 1/1/0                 | 0.2%         | low    | fake-suspect | ❌    | StarScout ai_label="suspicious" — flagged as having fake stars          |
| [iexa/justexp](https://github.com/iexa/justexp)                                                                         | 170     | 170      | 0/0/0                 | 0.0%         | low    | fake-suspect | ❌    | StarScout ai_label="suspicious" — flagged as having fake stars          |
| [azkadev/terminal_flutter](https://github.com/azkadev/terminal_flutter)                                                 | 1       | 1        | 0/0/0                 | 0.0%         | low    | fake-suspect | ❌    | StarScout ai_label="suspicious" — flagged as having fake stars          |
| [djwalkzz16/krunker.io-hack](https://github.com/djwalkzz16/krunker.io-hack)                                             | 24      | 24       | 0/0/0                 | 0.0%         | low    | fake-suspect | ❌    | StarScout ai_label="suspicious" — flagged as having fake stars          |
| [hwidspoofer1/HWID-Spoofer-and-Cleaner-2024](https://github.com/hwidspoofer1/HWID-Spoofer-and-Cleaner-2024)             | 4       | 4        | 0/0/0                 | 0.0%         | low    | fake-suspect | ❌    | StarScout ai_label="suspicious" — flagged as having fake stars          |
| [Stallion77RepoOfficial/TenorshareiAnyGo-Resetter](https://github.com/Stallion77RepoOfficial/TenorshareiAnyGo-Resetter) | 26      | 26       | 0/0/1                 | 92.3%        | high   | fake-suspect | ✅    | StarScout ai_label="suspicious" — flagged as having fake stars          |
| [kazura233/web-daemon](https://github.com/kazura233/web-daemon)                                                         | 667     | 667      | 1/0/0                 | 0.0%         | low    | fake-suspect | ❌    | StarScout ai_label="suspicious" — flagged as having fake stars          |
| [Imran407704/stest](https://github.com/Imran407704/stest)                                                               | 0       | 0        | 0/0/0                 | 0.0%         | low    | fake-suspect | ❌    | StarScout ai_label="suspicious" — flagged as having fake stars          |
| [LaqiraProtocol/LaqiraToken](https://github.com/LaqiraProtocol/LaqiraToken)                                             | 183     | 183      | 2/0/0                 | 0.0%         | low    | organic      | ✅    | StarScout ai_label="blockchain" — classified as legitimate domain       |
| [NexaAI/nexa-sdk](https://github.com/NexaAI/nexa-sdk)                                                                   | 8,033   | 1,433    | 3/1/1                 | 1.3%         | low    | organic      | ✅    | StarScout ai_label="ai" — classified as legitimate domain               |
| [adysec/ARL](https://github.com/adysec/ARL)                                                                             | 876     | 876      | 7/4/0                 | 1.7%         | low    | organic      | ✅    | StarScout ai_label="tool/application" — classified as legitimate domain |
| [mgtv-tech/jetcache-go](https://github.com/mgtv-tech/jetcache-go)                                                       | 512     | 512      | 3/4/4                 | 11.1%        | medium | organic      | ❌    | StarScout ai_label="basic-utility" — classified as legitimate domain    |
| [diamcircle/Aurora](https://github.com/diamcircle/Aurora)                                                               | 247     | 247      | 0/0/2                 | 95.1%        | high   | organic      | ❌    | StarScout ai_label="blockchain" — classified as legitimate domain       |
| [holochain/launcher](https://github.com/holochain/launcher)                                                             | 71      | 70       | 0/0/3                 | 55.7%        | high   | organic      | ❌    | StarScout ai_label="tool/application" — classified as legitimate domain |
| [DosX-dev/MemCleaner](https://github.com/DosX-dev/MemCleaner)                                                           | 230     | 230      | 1/1/5                 | 39.6%        | high   | organic      | ❌    | StarScout ai_label="tool/application" — classified as legitimate domain |
| [YPAndrew0907/Animal-Simulation-game](https://github.com/YPAndrew0907/Animal-Simulation-game)                           | 248     | 248      | 4/0/0                 | 0.0%         | low    | organic      | ✅    | StarScout ai_label="tool/application" — classified as legitimate domain |
