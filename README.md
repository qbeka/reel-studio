# Reel

Reel is a local editor for product demos that stay interactive. You record a workflow from
a React scene, add chapters and captions, and export a static page. A viewer can pause it,
scrub it, press **Take over** to use the product from that exact moment, then return to your
story at a chapter.

![A viewer has taken control of a receipt demo. The split is edited, the balances are recomputed, and a thin line forks from the timeline.](docs/media/cover.png)

**[Try the live demo](https://www.qendrimbeka.com/projects/reel/)**, watch the
[18 second demo](docs/media/demo.mp4), or see the
[61 second walkthrough](docs/media/walkthrough.mp4), which is silent with on-screen notes.

## Quick start

You need Node 22 and pnpm 12. If you have Node, `corepack enable` gives you the right pnpm.

```bash
git clone https://github.com/qbeka/reel-studio.git
```

```bash
cd reel-studio && pnpm install --frozen-lockfile
```

Run a finished demo, then open <http://127.0.0.1:4173/projects/reel/>.

```bash
pnpm demo
```

Or open the editor on port 5174.

```bash
pnpm dev
```

## What it does

Reel records semantic commands that a scene declares, such as `setSplit`, with their logical
time. It does not record pixels, DOM changes or mouse paths, so playback is the real
application running and a viewer can take over at any moment.

- **Seek anywhere.** Reel restores a checkpoint and replays to the exact time.
- **Take over.** The state on screen becomes the viewer's own copy, and the timeline forks.
- **Return.** Back to demo restores the recorded moment and keeps the viewer's copy one press
  away, and Choose a moment offers the chapters. States are never merged, and nothing a
  viewer does reaches the recording, the URL or storage.
- **Edit safely.** If you remove a command that later ones need, Reel shows what breaks and
  will not save a recording that cannot play.
- **Export a folder.** It runs on any static host, under any path, with a plain transcript
  and a poster for embedding. See [docs/EMBED.md](docs/EMBED.md).

Reel works with scenes you register at build time. It cannot record arbitrary websites. For
that, use a tool like [rrweb](https://github.com/rrweb-io/rrweb).

## Results

| | |
|---|---|
| **Seek** | p95 17 ms on a generated 20,000 command log, against 973 ms replaying from the start. On a real 10 command recording both take 1.1 ms. |
| **First seek** | About 1.1 s at worst on that same log, in a fresh page. The page appears in 119 ms. |
| **Correctness** | 0 mismatches against replay at 5,332 positions. An independent model of each scene agreed on every log. |
| **Test quality** | 14 of 14 seeded failures caught. 36 of 38 mutants killed, 2 equivalent. |
| **Viewer size** | 91 KB of JavaScript and CSS with gzip. It needs no backend. |

Measured on one Apple M5 Pro laptop in headless Chromium, with other work running. These are
lab numbers. [What they leave out](docs/REPORT.md#what-the-headline-leaves-out).

## Add a scene

A scene is an adapter with a seed, a reducer and a React renderer.

```ts
export const counterAdapter: SceneAdapter<CounterState> = {
  id: 'counter',
  version: 1,
  commandTypes: ['add'],
  targets: [{ id: 'total', label: 'Total' }],
  init: (seed) => ({ total: 0, rng: seed }),
  parse: (type, payload) => (Number.isInteger(payload.by) ? null : 'add needs a whole number.'),
  precondition: () => null,
  apply: (state, command) => ({ ...state, total: state.total + (command.payload.by as number) }),
  // Plus title, summary, layouts, serialize, restore, describe, targetOf and Render.
};
```

Then add one entry to [src/scenes/registry.ts](src/scenes/registry.ts) and one line to
`src/styles/scenes.css`. [docs/FORMAT.md](docs/FORMAT.md) is the full contract. Two scenes are
included: a synthetic receipt split and a retry queue with seeded backoff.

## Export from the command line

```bash
pnpm export projects/receipt-split-release.reel.json --out exports/receipt
```

```bash
pnpm exec tsx scripts/verify-bundle.ts exports/receipt
```

The second command checks every file hash and replays the story against the manifest.

## Test it

Run types, lint and the copy check.

```bash
pnpm check
```

Run the unit tests, including the oracles, fuzz tests and negative controls.

```bash
pnpm test
```

Run the browser tests. Chromium runs all 82. WebKit and Firefox repeat the 9 exported viewer
tests. On a Mac, keep the display awake, or WebKit clicks fail.

```bash
pnpm exec playwright install chromium webkit firefox
```

```bash
pnpm test:e2e
```

## Measure it

A quick engine timing, in about 30 seconds.

```bash
pnpm bench:smoke
```

The full protocol, in about 15 minutes.

```bash
pnpm bench
```

## Read more

| Document | Contents |
|---|---|
| [docs/REPORT.md](docs/REPORT.md) | Results, limits, what failed and what changed. |
| [site/](site/) | The project page. It runs the viewer directly, with a short authoring view. Build it with `pnpm build:site`. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How seeking, branches and export work. |
| [docs/FORMAT.md](docs/FORMAT.md) | The adapter contract and project file. |
| [docs/DESIGN.md](docs/DESIGN.md) | The central workflow and the design that was rejected. |
| [docs/EMBED.md](docs/EMBED.md) | Hosting and embedding. |
| [docs/RESEARCH.md](docs/RESEARCH.md) | Sources and pinned versions. |
| [bench/PROTOCOL.md](bench/PROTOCOL.md) | How the numbers are measured. |

## License

MIT for the code here. Fonts and React keep their own licenses. See [NOTICE.md](NOTICE.md).
The receipt data is invented, and this project holds no Koba code or data.
