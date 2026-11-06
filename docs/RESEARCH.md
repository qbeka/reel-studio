# Research notes

Sources read on 6 November 2026. Versions are those in `package.json` and the lockfile.

## Existing tools

| Source | What it does | What Reel takes | What Reel does differently |
|---|---|---|---|
| [rrweb](https://github.com/rrweb-io/rrweb), MIT | Records a DOM snapshot and later mutations, and replays them. Its snapshot output runs no JavaScript. | The idea of an event log with a seekable player. | Reel records declared commands, so a replay is the real application running, and a viewer can take over. Reel cannot record arbitrary sites. rrweb can. |
| [Theatre.js](https://www.theatrejs.com/docs/latest/getting-started/with-html-svg) | A studio edits sequences and exports a JSON state that a runtime loads without the studio. | The split between an authoring tool and a small runtime fed by exported data. | Theatre sequences animate values. Reel replays application commands. The linked manual page returned 404, so this rests on the tutorial page. |

## Standards and guidance

| Source | Used for |
|---|---|
| [WAI-ARIA slider pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider/) | Keys for the story slider, and `aria-valuetext` for time and chapter. |
| [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) | Transactions for keeping the last save. Failures are read from the transaction, and quota failures become a plain message. |
| [Web Animations](https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API) | The distinction between timeline time and rendering. Reel keeps the same split. CSS transitions were enough for the camera, so the API itself is not used. |
| [Vercel interface guidelines](https://vercel.com/design/guidelines) | Input alternatives for drags, visible focus, undo for edits, reduced motion, transform-only animation. No affiliation. Where they differ from the project rules, such as title case, the project rules win. |

## Name

The repository is `qbeka/reel-studio`. The npm name `reel-studio` is taken by an unrelated
package (0.2.7), and several unrelated GitHub repositories use the name. This project is
not published to npm. Search again before any package release.

## Pinned versions

React 19.3.1, Vite 8.3.6, TypeScript 7.0.2, Vitest 5.1.0, Playwright 1.65.0, Geist 1.9.1.
