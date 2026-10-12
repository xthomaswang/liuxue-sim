// 与 Python 参考实现（work/validate_design.py）逐学期对拍。
// 夹具由 work/export_trajectories.py 导出：每局的投入序列、事件选择、各学期末四属性、支线、概率与机会。
// 这里把同样的选择喂给 reducer，逐步比较。两套实现由不同的作者依据同一份文档写成。

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mastersOptions } from "../index";
import type { ActiveRun, ChoiceId, Economy, Focus, MastersProgram, Opportunity, RunState } from "../index";
import { act, asActive, start } from "./helpers";

interface FixtureTerm {
  focus: Focus;
  events: Array<[string, ChoiceId]>;
  stats: number[];
}
interface FixtureMasters {
  years: 1 | 2;
  fee: number;
  terms: FixtureTerm[];
  counts: Record<Focus, number>;
  prob: Record<Opportunity, number | null>;
  offers: Record<Opportunity, boolean>;
}
interface FixtureRun {
  seed: number;
  economy: Economy;
  trait: string;
  style: string;
  hs: [ChoiceId, ChoiceId];
  hsStats: number[];
  terms: FixtureTerm[];
  arcs: { A: string; B: string };
  counts: Record<Focus, number>;
  ugProb: Record<Opportunity, number | null>;
  ugOffers: Record<Opportunity, boolean>;
  masters: FixtureMasters[];
}

// 用 fs 读取而不是 import，避免类型检查去推断这个几百 KB 的 JSON。
const fixture = JSON.parse(readFileSync(new URL("../../../tests/fixtures/trajectories.json", import.meta.url), "utf8")) as { runs: FixtureRun[] };
const runs = fixture.runs;
const vector = (run: ActiveRun): number[] => [run.stats.money, run.stats.academics, run.stats.career, run.stats.wellbeing];

function playTerms(from: RunState, terms: FixtureTerm[], label: string): ActiveRun {
  let state = from;
  terms.forEach((term, index) => {
    expect(state.phase, `${label} 第 ${index + 1} 学期开始`).toBe("FOCUS");
    state = act(state, { type: "CHOOSE_FOCUS", focus: term.focus });
    for (const [eventId, choiceId] of term.events) state = act(state, { type: "CHOOSE_EVENT", eventId, choiceId });
    expect(state.phase, `${label} 第 ${index + 1} 学期结算`).toBe("TERM_REVIEW");
    expect(vector(asActive(state)), `${label} 第 ${index + 1} 学期末四属性`).toEqual(term.stats);
    state = act(state, { type: "NEXT_TERM" });
  });
  return asActive(state);
}

function expectOffers(run: ActiveRun, degree: "UG" | "MS", prob: Record<Opportunity, number | null>, offers: Record<Opportunity, boolean>, label: string): void {
  const graduation = run.graduations[degree];
  expect(graduation?.probabilities, `${label} 概率`).toEqual(prob);
  for (const key of ["PHD", "LOCAL_JOB", "HOME_JOB"] as const) {
    expect(graduation?.outcomes?.[key] === "OFFERED", `${label} ${key} 是否取得`).toBe(offers[key]);
    expect(graduation?.outcomes?.[key] === "INELIGIBLE", `${label} ${key} 是否无资格`).toBe(prob[key] === null);
  }
}

describe("与 Python 参考实现对拍", () => {
  it("夹具规模", () => {
    expect(runs.length).toBeGreaterThanOrEqual(300);
    expect(runs.filter((run) => run.masters.length > 0).length).toBeGreaterThanOrEqual(30);
  });

  it("每一局：高中、本科八学期逐期、支线、毕业概率与结果、硕士续篇全部一致", () => {
    let mastersContinuations = 0;
    for (const run of runs) {
      const label = `seed ${run.seed} ${run.economy} ${run.style}`;
      let state = act(start(run.seed), { type: "CONFIRM_SETUP", economy: run.economy, aspiration: "DISCOVERY", name: "" });
      expect(asActive(state).profile.trait, `${label} 自然特质`).toBe(run.trait);
      state = act(state, { type: "CHOOSE_EVENT", eventId: "HS_01", choiceId: run.hs[0] });
      state = act(state, { type: "CHOOSE_EVENT", eventId: "HS_02", choiceId: run.hs[1] });
      expect(vector(asActive(state)), `${label} 高中后四属性`).toEqual(run.hsStats);
      state = act(state, { type: "CHOOSE_SCHOOL", unitid: (asActive(state).offers ?? [])[0].unitid });

      const preview = playTerms(state, run.terms, label);
      expect(preview.phase).toBe("GRAD_PREVIEW");
      expect(preview.arcs, `${label} 支线`).toEqual(run.arcs);
      expect(preview.focusCounts, `${label} 投入计数`).toEqual(run.counts);
      const results = asActive(act(preview, { type: "REVEAL_GRADUATION" }));
      expectOffers(results, "UG", run.ugProb, run.ugOffers, `${label} 本科`);

      const eligible = mastersOptions(results).filter((option) => option.eligible).map((option) => option.program);
      const expected = run.masters.map((item) => (item.years === 1 ? "MS_1Y" : "MS_2Y"));
      expect(eligible, `${label} 可选硕士方案`).toEqual(expected);

      for (const masters of run.masters) {
        const program: MastersProgram = masters.years === 1 ? "MS_1Y" : "MS_2Y";
        const mLabel = `${label} ${program}`;
        const entered = act(results, { type: "ENTER_MASTERS", program });
        const done = playTerms(entered, masters.terms, mLabel);
        expect(done.phase).toBe("GRAD_PREVIEW");
        expect(done.focusCounts, `${mLabel} 投入计数`).toEqual(masters.counts);
        expect(done.arcs, `${mLabel} 支线不变`).toEqual(run.arcs);
        expectOffers(asActive(act(done, { type: "REVEAL_GRADUATION" })), "MS", masters.prob, masters.offers, `${mLabel} 硕士`);
        mastersContinuations++;
      }
    }
    expect(mastersContinuations).toBeGreaterThanOrEqual(50);
  });
});
