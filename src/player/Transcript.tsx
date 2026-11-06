import { memo, useState } from 'react';
import { formatTime } from '../core/project';
import type { TranscriptLine } from '../core/transcript';

/** Longer stories start collapsed, so opening a long log does not build its rows up front. */
const OPEN_UP_TO = 200;

/** Memoized because the viewer re-renders on every animation frame while playing. */
export const Transcript = memo(function Transcript({
  lines,
  disabled,
  onSeek,
}: {
  lines: readonly TranscriptLine[];
  disabled: boolean;
  onSeek: (t: number) => void;
}) {
  const [open, setOpen] = useState(lines.length <= OPEN_UP_TO);
  return (
    <section aria-labelledby="reel-transcript-title" className="reel-transcript">
      <h2 id="reel-transcript-title">Transcript</h2>
      {open ? (
        <ol>
          {lines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the list never changes after load.
            <li key={index} className={line.kind === 'chapter' ? 'reel-transcript-chapter' : undefined}>
              <button type="button" disabled={disabled} onClick={() => onSeek(line.t)}>
                <span>{formatTime(line.t)}</span>
                {line.kind === 'chapter' ? line.title : line.text}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p>
          <button type="button" onClick={() => setOpen(true)}>
            <span />
            Show all {lines.length} steps
          </button>
        </p>
      )}
      <p className="reel-transcript-link">
        <a href="./transcript.html">Open the plain transcript page</a>
      </p>
    </section>
  );
});
