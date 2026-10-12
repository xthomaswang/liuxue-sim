// 天赋：十连抽的十张各占一整行，按稀有度整行着色；点一下选中/取消，选满才能下一步。

import { useMemo, useState } from "react";
import { useGame } from "../../app/store";
import { setupView } from "../../engine";
import type { SetupRun } from "../../engine";
import { RarityTag } from "../components";
import { S } from "../strings";

export function TalentScreen(props: { state: SetupRun }) {
  const store = useGame();
  const view = useMemo(() => setupView(props.state), [props.state]);
  // 从分点屏返回时，保留刚才选的几张。
  const [chosen, setChosen] = useState<string[]>(() =>
    store.chosenTalents.filter((id) => view.draw.some((talent) => talent.id === id)),
  );
  const full = chosen.length >= view.pickCount;

  const toggle = (id: string) => {
    setChosen((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return current.length >= view.pickCount ? current : [...current, id];
    });
  };

  const next = () => {
    if (chosen.length !== view.pickCount) return;
    // 按抽出顺序提交，和点击先后无关。
    store.chooseTalents(view.draw.filter((talent) => chosen.includes(talent.id)).map((talent) => talent.id));
  };

  return (
    <div className="screen" data-testid="screen-talents">
      <p className="lead">
        <span>{S.talentLead(view.pickCount)}</span>
        <span className="muted" data-testid="talent-count">
          {S.talentCount(chosen.length, view.pickCount)}
        </span>
      </p>
      {view.draw.length === 0 ? <p className="warn small">{S.talentEmpty}</p> : null}

      <div className="talent-list">
        {view.draw.map((talent) => {
          const selected = chosen.includes(talent.id);
          return (
            <button
              key={talent.id}
              type="button"
              className={`talent-row rarity-row-${talent.rarity}${selected ? " selected" : ""}`}
              aria-pressed={selected}
              data-testid={`talent-${talent.id}`}
              data-rarity={talent.rarity}
              onClick={() => toggle(talent.id)}
            >
              <span className="talent-head">
                <RarityTag rarity={talent.rarity} />
                <span className="talent-name">{talent.name}</span>
                {view.inherited === talent.id ? <span className="tag">{S.inherited}</span> : null}
                <span className="talent-check" aria-hidden="true">
                  {selected ? "✓" : ""}
                </span>
              </span>
              <span className="talent-text">{talent.text}</span>
            </button>
          );
        })}
      </div>

      <button type="button" className="button primary big" disabled={!full} data-testid="to-allocate" onClick={next}>
        {S.next}
      </button>
    </div>
  );
}
