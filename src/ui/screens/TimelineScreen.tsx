// 人生轨迹：整局已经算完，这里一段一段显示出来。玩家只需要点“继续”（或点列表），也可以自动播放或直接看结局。
// 第四版（docs/24 §7）：每段带年龄；在校、暑假、毕业后、五年后四组分开着色；进入毕业后与五年后之前各有一条分隔。

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { useGame } from "../../app/store";
import type { TimelineEntry } from "../../engine";
import { deltaText } from "../format";
import { S } from "../strings";

/** 自动播放的间隔：给刚出现的这一段留出读的时间，行越多停得越久。 */
export function autoDelay(lines: number): number {
  return Math.min(2800, Math.max(1000, 700 + 260 * lines));
}

export function TimelineScreen(props: { entries: TimelineEntry[]; shown: number }) {
  const { revealTo, openSummary } = useGame();
  return <TimelineView entries={props.entries} shown={props.shown} onReveal={revealTo} onSummary={openSummary} />;
}

/** 纯展示：显示到第几段由外面决定，“继续”“直接看结局”只是请外面改段数。 */
export function TimelineView(props: {
  entries: TimelineEntry[];
  shown: number;
  onReveal: (shown: number) => void;
  onSummary: () => void;
}) {
  const { entries, shown, onReveal: revealTo, onSummary: openSummary } = props;
  const [auto, setAuto] = useState(false);
  const done = shown >= entries.length;
  const latestLines = shown > 0 ? entries[shown - 1].lines.length : 0;

  const next = () => {
    if (!done) revealTo(shown + 1);
  };

  // 自动播放：等刚出现的这一段读完，再显示下一段；到结尾自己停下。
  useEffect(() => {
    if (!auto || done) return;
    const timer = window.setTimeout(() => revealTo(shown + 1), autoDelay(latestLines));
    return () => window.clearTimeout(timer);
  }, [auto, done, shown, latestLines, revealTo]);

  // 新的一段出现后滚到底，让最新的内容留在眼前。
  useEffect(() => {
    const scroller = document.scrollingElement ?? document.documentElement;
    scroller.scrollTop = scroller.scrollHeight;
  }, [shown]);

  const firstLife = entries.findIndex((entry) => entry.group === "LIFE");
  const leftEarly = entries.some((entry) => entry.id === "EARLY");

  return (
    <div className="screen" data-testid="screen-timeline">
      <div className="timeline" data-testid="timeline" data-shown={shown} data-total={entries.length} onClick={next}>
        {shown === 0 ? <p className="muted center">{S.timelineEmpty}</p> : null}
        <ol className="tl-list">
          {entries.slice(0, shown).flatMap((entry, index) => {
            const latest = index === shown - 1;
            // 分组与年龄是第四版加的；缺省时按在校、无年龄处理，界面照常显示。
            const group = entry.group ?? "SCHOOL";
            const age = typeof entry.age === "number" ? entry.age : null;
            const items = [];
            if (index === firstLife) {
              items.push(
                <li key="divider-life" className="tl-divider" data-testid="timeline-divider-life">
                  {leftEarly ? S.dividerLifeEarly : S.dividerLife}
                </li>,
              );
            }
            if (group === "END") {
              items.push(
                <li key="divider-outcome" className="tl-divider" data-testid="timeline-divider-outcome">
                  {S.dividerOutcome}
                </li>,
              );
            }
            items.push(
              <li
                key={entry.id}
                className={`tl-entry group-${group.toLowerCase()}${latest ? " latest" : ""}`}
                data-testid={`timeline-entry-${entry.id}`}
                data-group={group}
              >
                <span className="tl-when">
                  <span className="tl-label">{entry.label}</span>
                  {age !== null ? <span className="tl-age">{S.ageLabel(age)}</span> : null}
                </span>
                <ul className="tl-lines">
                  {entry.lines.map((line, lineIndex) => (
                    <li
                      key={lineIndex}
                      className={`tl-line kind-${line.kind.toLowerCase()}`}
                      // 最新的一段逐行淡入；--i 决定每行晚多久出现。
                      style={latest ? ({ "--i": lineIndex } as CSSProperties) : undefined}
                    >
                      {line.text}
                      {deltaText(line.delta) ? <span className="tl-delta">{deltaText(line.delta)}</span> : null}
                    </li>
                  ))}
                </ul>
              </li>,
            );
            return items;
          })}
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
