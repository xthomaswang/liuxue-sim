// 端到端自动点击脚本：在真实 WebKit 里从开局点到指定阶段。由 scripts/e2e-webkit.sh 在前面拼上一行
//   const CONFIG = { seed, focus?, fallback?, choices?, defaultChoice?, masters?, requireMasters?, stopAt?, after?, resume? };
// 再交给 scripts/e2e/snap.swift 执行。返回值是一段 JSON 摘要，由外层脚本检查。
// 只通过 data-testid 找元素、只做点击与输入，不碰游戏内部状态。
//   focus          每学期想选的安排类别，按学期循环；这学期没有或买不起就按 fallback 顺序找下一个
//   choices        指定某些事件选 A 还是 B；其余按 defaultChoice（"A"、"B"，缺省为 A/B 交替）
//   masters        毕业时若这个硕士方案可选就选它
//   requireMasters 这一局没读成硕士就换下一个种子重来，直到读成（用来稳定地覆盖硕士路线）
//   resume         不开新局，只检查页面加载后恢复出来的存档停在 stopAt

// 离屏 WebView 会把 setTimeout 节流到约 1 秒一次，改用不受节流的 MessageChannel 让出事件循环。
const tick = () =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve(null);
    channel.port2.postMessage(0);
  });
const settle = async () => {
  for (let i = 0; i < 4; i++) await tick();
};
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const all = (prefix) => [...document.querySelectorAll(`[data-testid^="${prefix}"]`)];
const phase = () => q("app")?.getAttribute("data-phase") ?? null;

const problems = [];
let clicks = 0;
// 默认界面上实际显示的字数，逐屏累加；用来粗估阅读量，不等于真人计时。
let screens = 0;
let defaultChars = 0;
function measureScreen() {
  const text = document.querySelector(".screen")?.innerText ?? "";
  screens++;
  defaultChars += text.replace(/\s/g, "").length;
}

function checkText() {
  const text = document.body.innerText;
  for (const bad of ["undefined", "NaN", "{{", "}}", "[object", "NOT_IMPLEMENTED"]) {
    if (text.includes(bad)) problems.push(`页面出现 “${bad}”（阶段 ${phase()}）`);
  }
  if (q("fatal")) problems.push(`出现兜底错误页（阶段 ${phase()}）`);
}

async function clickElement(element, what) {
  if (!element) throw new Error(`找不到 ${what}（阶段 ${phase()}）`);
  if (element.disabled) throw new Error(`${what} 被禁用（阶段 ${phase()}）`);
  element.click();
  clicks++;
  await settle();
  checkText();
}
const click = (id) => clickElement(q(id), id);

const DEFAULT_FOCUS = ["STUDY", "CAREER", "CAMPUS", "WORK", "STUDY", "REST", "CAREER", "STUDY", "STUDY", "CAREER", "REST", "STUDY"];
const FALLBACK = ["STUDY", "CAREER", "WORK", "CAMPUS", "REST"];
let focusIndex = 0;
let eventIndex = 0;
let tookMasters = false;

const talentButtons = () => all("talent-").filter((element) => element.tagName === "BUTTON");

function planFor(category) {
  return all("plan-").find((button) => {
    const id = button.getAttribute("data-testid").slice("plan-".length);
    return button.tagName === "BUTTON" && !button.disabled && (id === category || id.startsWith(`${category}_`));
  });
}

async function step() {
  const current = phase();
  if (current === "SETUP") {
    const picks = talentButtons().slice(0, 3);
    if (picks.length < 3) throw new Error("天赋卡不足三张");
    for (const button of picks) await clickElement(button, button.getAttribute("data-testid"));
    return click("start");
  }
  if (current === "HIGH_SCHOOL_EVENT" || current === "CORE_EVENT" || current === "ARC_EVENT") {
    const id = q("screen-event").getAttribute("data-event-id");
    let pick = CONFIG.choices?.[id] ?? CONFIG.defaultChoice ?? (eventIndex % 2 === 0 ? "A" : "B");
    eventIndex++;
    if (q(`choice-${pick}`).disabled) pick = pick === "A" ? "B" : "A";
    return click(`choice-${pick}`);
  }
  if (current === "SCHOOL_OFFERS") return click("offer-0");
  if (current === "FOCUS") {
    const list = CONFIG.focus ?? DEFAULT_FOCUS;
    const wanted = list[focusIndex++ % list.length];
    const button = [wanted, ...(CONFIG.fallback ?? FALLBACK)].map(planFor).find(Boolean);
    return clickElement(button, `plan-${wanted}`);
  }
  if (current === "GRAD_PREVIEW") return click("reveal");
  if (current === "GRAD_RESULTS") {
    const masters = CONFIG.masters ? q(`masters-${CONFIG.masters}`) : null;
    if (masters && !masters.disabled) {
      tookMasters = true;
      return click(`masters-${CONFIG.masters}`);
    }
    for (const route of ["PHD", "LOCAL_JOB", "HOME_JOB", "TRANSITION"]) {
      const button = q(`route-${route}`);
      if (button && !button.disabled) return click(`route-${route}`);
    }
  }
  throw new Error(`没有可执行的下一步（阶段 ${current}）`);
}

async function startWithSeed(seed) {
  if (phase() === "ENDING") await click("play-again");
  if (phase() !== "SETUP") throw new Error(`无法回到开局（阶段 ${phase()}）`);
  if (!q("seed-input")) await click("seed-toggle");
  const input = q("seed-input");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, String(seed));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
  await click("seed-apply");
  focusIndex = 0;
  eventIndex = 0;
  tookMasters = false;
}

async function playTo(stopAt) {
  for (let guard = 0; guard < 400 && phase() !== stopAt; guard++) {
    measureScreen();
    await step();
  }
  if (phase() !== stopAt) throw new Error(`没有到达 ${stopAt}，停在 ${phase()}`);
}

await settle();
await settle();
checkText();

const stopAt = CONFIG.stopAt ?? "ENDING";
let seed = CONFIG.seed;
if (CONFIG.resume) {
  // 什么都不点：读档恢复出来的阶段必须就是上一次停下的地方。
  if (phase() !== stopAt) throw new Error(`读档后停在 ${phase()}，期望 ${stopAt}`);
} else if (stopAt === "SETUP") {
  await startWithSeed(seed);
  for (const button of talentButtons().slice(0, 3)) await clickElement(button, button.getAttribute("data-testid"));
} else {
  for (let attempt = 0; ; attempt++) {
    if (attempt >= 80) throw new Error("连续 80 个种子都没有读成硕士");
    clicks = 0;
    screens = 0;
    defaultChars = 0;
    await startWithSeed(seed);
    await playTo(stopAt);
    if (!CONFIG.requireMasters || tookMasters) break;
    seed++;
  }
}
measureScreen();

const summary = { phase: phase(), seed, clicks, screens, defaultChars, tookMasters, problems };
// 顶栏的阶段标题与四属性、当前屏的正文：用来比较“关掉再打开”前后是否完全一样。
summary.stageTitle = q("stage-title")?.innerText ?? null;
summary.stats = document.querySelector(".stat-strip")?.innerText.replace(/\s+/g, " ") ?? null;
summary.screenText = (document.querySelector(".screen")?.innerText ?? "").replace(/\s+/g, " ").slice(0, 400);
// 第二版界面不该再有可展开的长文（结局页的“回看这次经历”除外）。
summary.expandButtons = document.querySelectorAll("[aria-expanded]").length;
if (phase() === "ENDING") {
  summary.title = q("ending-title")?.innerText ?? null;
  summary.label = q("ending-label")?.innerText ?? null;
  summary.tier = q("ending-card")?.getAttribute("data-tier") ?? null;
  summary.combo = q("card-combo")?.innerText ?? null;
  summary.talents = q("ending-talents")?.innerText.replace(/\s+/g, " ") ?? null;
}
if (phase() === "SCHOOL_OFFERS") {
  summary.tierDrawn = q("tier-drawn")?.innerText ?? null;
  summary.offers = [0, 1, 2].map((i) => q(`offer-${i}`)?.innerText.split("\n")[0] ?? null);
}

// 截图前的收尾动作。
if (CONFIG.after === "lookback" && phase() === "ENDING") {
  await click("look-back");
  window.scrollTo(0, 0);
} else if (CONFIG.after === "card" && phase() === "ENDING") {
  q("ending-card").scrollIntoView();
} else if (CONFIG.after === "clear") {
  // 测试收尾：清掉持久化存储里的存档，不给下一次运行留痕迹。
  localStorage.clear();
} else if (CONFIG.after === "gallery") {
  await click("open-gallery");
  summary.galleryUnlocked = document.querySelectorAll('[data-testid^="gallery-tier-"][data-unlocked="true"]').length;
  window.scrollTo(0, 0);
} else {
  window.scrollTo(0, 0);
}
await settle();
checkText();
return JSON.stringify(summary);
