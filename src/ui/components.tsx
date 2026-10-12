// 各屏共用的小组件，全部是纯展示。

import { TEXTS } from "../content";
import type { Stats, TalentRarity } from "../engine";
import { STAT_ORDER } from "./strings";

/** 一行四属性的当前值（人生轨迹顶部随显示进度更新）。 */
export function StatStrip(props: { stats: Stats }) {
  return (
    <dl className="stat-strip" data-testid="stat-strip">
      {STAT_ORDER.map((key) => (
        <div className="stat" key={key} title={TEXTS.stat[key].meaning}>
          <dt>{TEXTS.stat[key].name}</dt>
          <dd data-testid={`stat-${key}`}>{props.stats[key]}</dd>
          <div className="stat-bar" aria-hidden="true">
            <span style={{ width: `${props.stats[key]}%` }} />
          </div>
        </div>
      ))}
    </dl>
  );
}

/** 稀有度字母。颜色之外同时有文字，不靠颜色单独区分。 */
export function RarityTag(props: { rarity: TalentRarity }) {
  return <span className={`rarity rarity-${props.rarity}`}>{props.rarity}</span>;
}
