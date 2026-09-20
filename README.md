<h1><img src="./assets/senseek/exports/icon-128.png" width="60" align="center" alt="Senseek icon"> Senseek</h1>

> Semantic Page Search — Find what you mean.

Senseek is a browser extension for finding meaning inside the page you are reading. Add your own JEV API key in the extension settings; Senseek runs without a backend.

<p align="center">
  <img width="960" alt="Senseek finding a relevant passage on a webpage" src="./assets/senseek/previews/senseek-demo.png">
</p>

## Why Senseek?

Web pages are written for reading, not for searching exact phrases. You may remember an idea, a condition, or an answer without knowing the words used in the source. Senseek lets you describe what you mean and takes you to the relevant passage.

A general-purpose LLM can also power this kind of search, but JEV is a better fit for the task. Its focused evaluation API is built for fast passage relevance and sentence selection, keeping the search experience responsive.

## How it works

1. Open Senseek on any regular webpage.
2. Ask a question in natural language, such as “Can I still use it after canceling?”
3. Senseek extracts visible page text into short passages.
4. The browser sends the query and passages directly to JEV for semantic matching.
5. Results are ranked and the matching sentence is highlighted in the original page.

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

Senseek also has limits: it needs a valid JEV API key and network access, and it searches visible text in the current page. Images, scanned PDFs, closed iframes, and hidden content are not searchable.

## Try it

Load the `extension` directory as an unpacked Chrome or Edge extension, open Settings, and enter a key from the [TypeSafe console](https://console.typesafe.ai/keys).

See `extension/LICENSE` and `extension/NOTICE` for license and attribution details.
