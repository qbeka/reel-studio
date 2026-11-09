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

Viewer presses Take over. A second copy of the scene opens in a panel or dialog, reset to the
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

Viewer presses Take over at any moment. The scene does not move. The state on screen becomes
the viewer's own copy, the scene stops being inert, and the timeline line forks at the
paused position. Each edit adds a tick to the fork. Back to demo returns to the fork and
says in one sentence that the copy is set aside, with Bring my copy back beside it. Choose
a moment offers the chapters and marks any that match the viewer's state exactly.

```
+-----------------------------------------------+
|  scene, same state, now editable              |
|                                               |
|  ----o----------|-----------|---------------  |
|       \__|__|__   your copy, 2 edits          |
|  [Choose a moment]            [Back to demo]   |
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

Taking over. While the story plays, the stage draws a pointer of its own, labelled Reel. When
the viewer presses Take over, that pointer travels to the viewer's real one and lets go, the
window's title bar and the backdrop change colour, and a line leaves the timeline at the
paused position. Nothing inside the app moves. Each edit adds a tick to the viewer's line,
and going back sends the pointer home and leaves the line dashed, with Bring my copy back
beside it.

## The drawn pointer

Reel records commands, not pointer movement, so there is no recorded path to play. The
pointer is worked out from the log instead. It rests on the control of the last command,
and shortly before the next one it travels there and arrives as the command happens. It
depends only on the log and the time, so playing, scrubbing and a seek all draw the same
pointer, and the page says it is drawn. A scene names the control for each command with
`pointOf`. Without it the pointer goes to the command's target.

The camera works the same way. A shot eases in over 900 ms of logical time from the moment
it starts, so a seek into the middle of a move shows the middle of that move. A caption sits
beside its target, level with the pointer, on the side that has room. A narrow stage has no
room for that, so there the caption takes the title bar and the scene scrolls to follow the
pointer.

## Visual rules

- The scene is drawn as a finished product, Tabkin, which is invented. Its data is synthetic
  and the app says so.
- The app sits in a window on a backdrop. The backdrop is pale while the recording plays and
  dark forest while the copy on screen is the viewer's own.
- The timeline is cut into its chapters, each with its name as a way to jump there.
- Off-white paper, dark ink, hairline rules and one forest accent around the window. Colour
  inside the window belongs to the product: one hue per person, red for too much.
- Geist Serif for titles, captions and the transcript. Geist Sans for controls and dense
  data. Geist Serif has one weight, so hierarchy comes from size and colour.
- Motion is the pointer, the camera, the handoff and the fork. With reduced motion the
  pointer is still drawn where it belongs, the camera shows the whole scene, and nothing
  animates.
- The opening frame is a poster, so it shows the whole scene and the first press of Play
  starts the story from its beginning.

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
