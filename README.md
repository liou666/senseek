<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/senseek/senseek-logo-inverse.svg">
    <img src="./assets/senseek/senseek-logo.svg" width="280" alt="Senseek">
  </picture>
</h1>

**English** | [简体中文](./README.zh-CN.md) | [日本語](./README.ja.md)

> Semantic Page Search — Find what you mean.

Senseek is a browser extension for finding meaning inside the page you are reading. It opens as a compact, Ctrl+F-style search box and can expand to show ranked matches. Add your own JEV API key in the extension settings; Senseek runs without a backend.

<p align="center">
  <img width="960" alt="Senseek searching for access after cancellation, showing ranked matches and highlighting the current match in orange on the page" src="./assets/senseek/previews/senseek-demo.png">
  <br>
  <sub>Example search on a sample page. Scores are illustrative.</sub>
</p>

## Why Senseek?

Web pages are written for reading, not for searching exact phrases. You may remember an idea, a condition, or an answer without knowing the words used in the source. Senseek lets you describe what you mean and takes you to the relevant passage.

A general-purpose LLM can also power this kind of search, but JEV is a better fit for the task. Its focused evaluation API is built for fast passage relevance and sentence selection, keeping the search experience responsive.

## How it works

1. Open Senseek from the toolbar icon or its keyboard shortcut. The compact search box stays out of the way like the browser's native find box.
2. Ask a question in natural language, such as “Can I still use it after canceling?”
3. Senseek extracts page text, including navigation links, button labels, footers, and native collapsible sections, into short passages.
4. The browser sends the query and passages directly to JEV for semantic matching.
5. Results are ranked and the matching sentence is highlighted in the original page. Expand the box to inspect every match and its confidence.

The API key stays in the browser's local extension storage. Search requests go directly from the browser to TypeSafe/JEV; no Senseek server is involved.

## Senseek vs. `Ctrl+F`

| | `Ctrl+F` | Senseek |
| --- | --- | --- |
| Search method | Exact words or character patterns | Meaning, concepts, and paraphrases |
| Query | You need to know the source wording | Describe the idea in your own words |
| Results | Matches shown in page order | Relevant passages ranked by meaning |
| Reading flow | You scan each match yourself | Jump directly to the most relevant passage |

### Limits of `Ctrl+F`

- It cannot recognize synonyms or paraphrases.
- It depends on the exact wording being present on the page.
- It does not understand questions, conditions, or implied answers.
- Long pages can produce many noisy matches that still require manual reading.

Senseek also has limits: it needs a valid JEV API key and network access. It searches text in the current page and opens native collapsible sections when you select a match inside them. Images, scanned PDFs, closed iframes, and other hidden content are not searchable.

## Try it

Download the ZIP from the [latest release](https://github.com/liou666/senseek/releases/latest), unzip it, and load the extracted folder as an unpacked extension in Chrome or Edge 127+.

Open Settings and enter a key from the [TypeSafe console](https://console.typesafe.ai/keys). Click the toolbar icon or press the shortcut shown in Settings to open or close Senseek.

Settings also lets you choose English, 简体中文, or 日本語. The display language saves automatically and updates open search bars immediately. Page excerpts stay in their original language.

See `extension/LICENSE` and `extension/NOTICE` for license and attribution details.
