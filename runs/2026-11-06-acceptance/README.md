The acceptance run. `tests/e2e/acceptance.spec.ts` opens the second registered scene in the
editor, records a real workflow, edits chapters and captions, saves, reopens, exports from
the browser, verifies the bundle, hosts it under `/projects/reel/` on a plain static server,
seeks, takes control and returns.

`retry-queue-viewer.zip` is the bundle that run exported. `playwright.txt` is the output of
the full browser suite on Chromium, WebKit and Firefox.
