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
paused position. Nothing inside the app moves. The viewer's line then runs beside the
recording on the same time scale, with a dot for each thing they do and a hollow dot for
each thing the app answers by itself. Going back sends the pointer home and leaves the line
dashed, with Bring my copy back beside it.

## What only a recording of state can do

A moment of the story is a whole state, not a picture, and the player uses that in three
places.

- **Look without going.** Hovering the timeline works out the state at that moment and
  runs the scene on it at a small size. Nothing is stored for this. Beside it is a list of
  the values that differ from the moment on screen, and those parts are outlined.
- **Compare.** Compare holds one moment. Wherever the story goes next, the values that
  differ from the held moment are listed and outlined in the app itself. In a viewer's
  copy the same list compares the copy with the recording it left.
- **Take over.** Covered above.

The list comes from `fields`, a short reading of the state that each scene supplies. A
scene without one gets an exact comparison of its serialized state by path. The outlines
come from a different source on purpose: the player draws the other state out of sight
with the same code and walks the two results side by side, so it needs no knowledge of
the scene and cannot disagree with what is on screen.

## The drawn pointer and the drawn keys

Reel records commands, not pointer movement or key presses, so there is no recorded path
to play. The pointer is worked out from the log instead. It rests on the control of the
last command, and shortly before the next one it reaches for that control, quick away and
slow onto it, and arrives ahead of the command. The button goes down just before the
command and comes up as it happens, and the control under it darkens as a pressed control
does. A command that sets a typed value is drawn as a press on its field, the old value
selected, and then one key at a time, with the last key landing as the command happens.
The scene says what was typed with `typedOf`, and the letters are drawn over the field, so
the scene's own markup stays a pure reading of its state.

All of it depends only on the log and the time, so playing, scrubbing and a seek draw the
same thing, and the page says it is drawn. A scene names the control for each command with
`pointOf`. Without it the pointer goes to the command's target.

## The camera and the captions

A shot is a move between two framings. It sets off 420 ms before the command it sits on, so
the camera is already moving as the click lands, and takes 1.2 s of logical time. Its pace
is that of a directed move: a small lean the wrong way, then away quickly, then a long
settle with no overshoot. A seek into the middle of a move shows the middle of that move.
While a close shot holds, everything outside its subject is veiled, which does more to
direct the eye than zoom does, so the zoom stops at 1.22.

A caption is set under the picture, in a band of its own between the window and the
timeline, like a subtitle. It can never cover the control it describes, because it is
never over the app. A narrow stage has no room for the band, so there the caption takes
the title bar and the scene scrolls to follow the pointer.

## Visual rules

- Each scene is drawn as a finished product. Tabkin, a receipt splitter, is light and warm.
  Relaymoth, a delivery console for the retry queue, is dark and set partly in a monospace
  face. Both are invented, their data is synthetic, and each app says so.
- The app sits in a window on a backdrop. The backdrop is pale while the recording plays and
  dark forest while the copy on screen is the viewer's own.
- The timeline is cut into its chapters, each with its name as a way to jump there.
- Off-white paper, dark ink, hairline rules and one forest accent around the window. Colour
  inside the window belongs to the product: one hue per person, red for too much.
- Geist Serif for titles, captions and the transcript. Geist Sans for controls and dense
  data. Geist Serif has one weight, so hierarchy comes from size and colour.
- A story ends on a card that names it, says how many commands played, and offers the app
  to try, a replay, and on the project page the other demo.
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
