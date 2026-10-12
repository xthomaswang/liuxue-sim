// 人生轨迹：整局已经算完，这里一段一段显示出来。玩家只需要点“继续”（或点列表），也可以自动播放或直接看结局。

import { useEffect, useState } from "react";
import { useGame } from "../../app/store";
import type { TimelineEntry } from "../../engine";
import { deltaText } from "../format";
import { S } from "../strings";

const AUTO_INTERVAL_MS = 800;

export function TimelineScreen(props: { entries: TimelineEntry[]; shown: number }) {
  const { entries, shown } = props;
  const { revealTo, openSummary } = useGame();
  const [auto, setAuto] = useState(false);
  const done = shown >= entries.length;

  const next = () => {
    if (!done) revealTo(shown + 1);
  };

  // 自动播放：每隔一小段时间显示下一段，到结尾自己停下。
  useEffect(() => {
    if (!auto || done) return;
    const timer = window.setTimeout(() => revealTo(shown + 1), AUTO_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [auto, done, shown, revealTo]);

  // 新的一段出现后滚到底，让最新的内容留在眼前。
  useEffect(() => {
    const scroller = document.scrollingElement ?? document.documentElement;
    scroller.scrollTop = scroller.scrollHeight;
  }, [shown]);

  return (
    <div className="screen" data-testid="screen-timeline">
      <div className="timeline" data-testid="timeline" data-shown={shown} data-total={entries.length} onClick={next}>
        {shown === 0 ? <p className="muted center">{S.timelineEmpty}</p> : null}
        <ol className="tl-list">
          {entries.slice(0, shown).map((entry, index) => (
            <li
              key={entry.id}
              className={`tl-entry${index === shown - 1 ? " latest" : ""}`}
              data-testid={`timeline-entry-${entry.id}`}
            >
              <span className="tl-label">{entry.label}</span>
              <ul className="tl-lines">
                {entry.lines.map((line, lineIndex) => (
                  <li key={lineIndex} className={`tl-line kind-${line.kind.toLowerCase()}`}>
                    {line.text}
                    {deltaText(line.delta) ? <span className="tl-delta">{deltaText(line.delta)}</span> : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>

      <div className="timeline-controls">
        {done ? (
          <button type="button" className="button primary big" data-testid="to-summary" onClick={openSummary}>
            {S.toSummary}
          </button>
        ) : (
          <>
            <button type="button" className="button primary" data-testid="reveal-next" onClick={next}>
              {S.revealNext}
            </button>
            <button
              type="button"
              className="button"
              aria-pressed={auto}
              data-testid="auto-play"
              onClick={() => setAuto((value) => !value)}
            >
              {auto ? S.autoPause : S.autoPlay}
            </button>
            <button type="button" className="button" data-testid="skip-to-end" onClick={() => revealTo(entries.length)}>
              {S.skipToEnd}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
