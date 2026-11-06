# Embedding a demo

An export is a folder of static files. Put it anywhere, for example at `/projects/reel/`.

## Link to it

Link to the folder with its trailing slash, or to `index.html`.

```html
<a href="/projects/reel/">Open the demo</a>
```

All URLs in the bundle are relative. If a host serves the folder without a trailing slash
and does not redirect, relative URLs break. Static hosts normally redirect. If yours does
not, link to `/projects/reel/index.html`.

## Embed it

Use `embed.html`, which is a poster with no script.

```html
<iframe
  title="Fix a shared receipt, interactive demo"
  src="/projects/reel/embed.html"
  loading="lazy"
  style="width: 100%; max-width: 980px; aspect-ratio: 880 / 700; border: 0"
></iframe>
```

| Topic | Behaviour |
|---|---|
| Size | Set the size in your own CSS. `880 / 700` fits the wide stage with its controls. Below 560 px wide the scene uses its narrow layout, and the frame scrolls inside itself. |
| Loading | The poster loads one HTML file, one stylesheet and up to two fonts. No JavaScript loads until activation. |
| Activation | A plain link. The viewer loads inside the frame and plays. With reduced motion it does not play by itself. |
| Focus | Tab enters the frame at the poster link. After activation focus goes to Pause, without scrolling your page. Tab leaves the frame as usual, and the viewer holds no focus trap. |
| Keyboard | Shortcuts only work when focus is inside the frame, and never while typing in a field. |
| Host messages | None. The frame sends nothing to your page and needs no script from it. |
| Cleanup | Close the demo returns to the poster, which unloads the viewer. Removing the iframe also ends it. Nothing is stored. |
| Styles | Nothing crosses the frame. Scene styles are nested under one class. |
| Network | Only files in the bundle. No analytics, no fonts from other hosts. |

## Link to a moment

`#chapter=<id>` and `#t=<milliseconds>` open a moment in the story. Anything else is ignored.
Links never hold what a viewer typed.

## Remove it

Delete the folder and the iframe. There is no service to shut down.
