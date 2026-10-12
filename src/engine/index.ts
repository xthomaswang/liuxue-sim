// 规则引擎的公开接口。全部是纯函数：相同输入永远得到相同输出，不读时钟、不用 Math.random、不碰存储。
// 界面只通过这里的函数读写游戏状态，不自己计算任何规则。
//
// 流程（docs/06 第 5–6 节）：
//   createRun → SETUP（出身与十张天赋由 seed 推出）
//   CONFIRM_SETUP（选三张天赋）→ HIGH_SCHOOL_EVENT(HS_01) → CHOOSE_EVENT → HIGH_SCHOOL_EVENT(HS_02)
//   → CHOOSE_EVENT（同一原子操作里生成申请结果与三校 offer）→ SCHOOL_OFFERS
//   → CHOOSE_SCHOOL（进入本科第 1 学期：发资助、可能有突发小事）→ FOCUS
//   每学期：FOCUS → CHOOSE_PLAN → CORE_EVENT → CHOOSE_EVENT →（本科 S2–S7：ARC_EVENT → CHOOSE_EVENT）
//           → 同一操作里期末结算并直接进入下一学期的 FOCUS，或冻结毕业快照 → GRAD_PREVIEW（docs/16）
//   GRAD_PREVIEW → REVEAL_GRADUATION → GRAD_RESULTS → CHOOSE_ROUTE → ENDING
//                                               或（仅本科）ENTER_MASTERS → 硕士第 1 学期 FOCUS
//
// 实现分散在同目录的各模块里，这里只做再导出。

export * from "./types";
export { RULES_VERSION, CONTENT_VERSION } from "./constants";
export { draw01, hash32, pickIndex } from "./rng";
export { applyAction, baseReadiness, checkCatalog, createRun, setupView } from "./reducer";
export {
  admissionPreview,
  admissionResult,
  currentEvent,
  focusView,
  graduationView,
  lastOutcome,
  mastersOptions,
  routeOptions,
  sceneIntro,
  stageInfo,
  termLedger,
} from "./views";
export { endingView } from "./ending";
// 第三版（docs/22）：整局自动模拟、人生轨迹、人生总结、成就与天赋解锁。
export { autoAction, simulate, startPreview } from "./auto";
export { summaryView, timeline } from "./timeline";
export { evaluateRun } from "./progress";
export { loadSave, replay, serializeSave } from "./save";
