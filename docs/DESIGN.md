# Design

## Who it is for

Target user: a founder or engineer who needs to show how a product works to someone who
is not in the room.

Problem: a video cannot be tried, and a recording of mouse coordinates breaks when the
layout changes. Both are poor for a reader who uses a keyboard or a small screen.

Primary task: record a workflow from a supported React scene, shape it into a short story,
and export a static page where a viewer can stop the story and try the product.

## Central workflow: two approaches

The central moment is the viewer taking control of a running demo. Two designs were
sketched as storyboards.

### Approach A: sandbox beside the story (rejected)

Viewer presses Try it. A second copy of the scene opens in a panel or dialog, reset to the
start of the current chapter. The story stays paused behind it. Closing the panel returns
to the story.

```
+-----------------------------+   +-----------------------------+
| story (dimmed, paused)      |   | Sandbox                 [x] |
|                             |   |  scene, reset to chapter    |
|  ----o--------------------- |   |                             |
+-----------------------------+   +-----------------------------+
```

Rejected. It is simple to build and cannot corrupt the story, but the viewer loses the
exact moment they were curious about. A value they saw at 0:23 is gone if the sandbox
starts at the chapter boundary. Two scene copies also double the render cost on a phone,
where a side panel does not fit anyway.

### Approach B: fork in place (chosen)

Viewer presses Try it at any moment. The scene does not move. The state on screen becomes
the viewer's own copy, the scene stops being inert, and the timeline line forks at the
paused position. Each edit adds a tick to the fork. Return to story offers the chapters,
says which ones match the viewer's state exactly, and says plainly that anything else
clears the experiment.

```
+-----------------------------------------------+
|  scene, same state, now editable              |
|                                               |
|  ----o----------|-----------|---------------  |
|       \__|__|__   your copy, 2 edits          |
|  [Reset my changes]  [Return to story: ... ]  |
+-----------------------------------------------+
```

This keeps one stage, keeps the moment of curiosity, and makes the branch visible. The
cost is a stricter state boundary: story state, branch state and tracks must stay apart,
because the same stage shows all of them.

## Authoring layout: two approaches

Stage first (chosen): stage in the middle, a lane timeline underneath, and an inspector
that changes with the selection. Recording, trimming, captions and framing all act on the
same timeline.

Script first (rejected): a text document where each command is a line, in the style of a
transcript editor. It reads well for short logs, but framing and caption timing need a
spatial view, and command lists full of `setSplit` lines read poorly.

## The memorable interaction

The fork in the transport line. A thin rule leaves the timeline at the point of control,
gains a tick for each edit, and folds back when the viewer returns. Everything else stays
quiet: no gradients, no metric tiles, no background motion.

## Visual rules

- Warm white paper, dark ink, hairline rules, one forest accent.
- Geist Serif for titles, captions and the transcript. Geist Sans for controls and dense
  data. Geist Serif has one weight, so hierarchy comes from size and colour.
- Motion is limited to the camera and the fork. Reduced motion removes both transitions
  and uses a static full view.

## What a code review changed

A review on a clean clone found defects the tests had missed. Three changed the design:

- A branch needs its own base. Bringing a copy back reused the edited state as the base, so
  edited work looked unchanged and could be cleared with no warning.
- A fork can start inside a pending outcome, so `pendingEffects` joined the adapter contract.
- The return panel locks the scene and reads the live state, because a stored answer can
  go stale between showing it and acting on it.

## Decisions that shaped the architecture

See [FORMAT.md](FORMAT.md) for the formats and [ARCHITECTURE.md](ARCHITECTURE.md) for the
module boundaries.
