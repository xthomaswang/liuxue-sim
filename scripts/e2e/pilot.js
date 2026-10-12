// 端到端自动点击脚本：在真实 WebKit 里从开局点到指定阶段。由 scripts/e2e-webkit.sh 在前面拼上一行
//   const CONFIG = { seed, economy, aspiration, focus?, choices?, masters?, stopAt?, after? };
// 再交给 scripts/e2e/snap.swift 执行。返回值是一段 JSON 摘要，由外层脚本检查。
// 只通过 data-testid 找元素、只做点击与输入，不碰游戏内部状态。

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
const phase = () => q("app")?.getAttribute("data-phase") ?? null;

const problems = [];
let clicks = 0;
// 默认界面（不展开任何细节）上实际显示的字数，逐屏累加；用来粗估阅读量，不等于真人计时。
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

async function click(id) {
  const element = q(id);
  if (!element) throw new Error(`找不到 ${id}（阶段 ${phase()}）`);
  if (element.disabled) throw new Error(`${id} 被禁用（阶段 ${phase()}）`);
  element.click();
  clicks++;
  await settle();
  checkText();
}

const DEFAULT_FOCUS = ["STUDY", "CAREER", "CAMPUS", "WORK", "STUDY", "REST", "CAREER", "STUDY", "STUDY", "CAREER", "REST", "STUDY"];
let focusIndex = 0;
let eventIndex = 0;

async function step() {
  const current = phase();
  if (current === "SETUP") {
    await click(`family-${CONFIG.economy}`);
    await click(`aspiration-${CONFIG.aspiration}`);
    await click("start");
    return;
  }
  if (current === "HIGH_SCHOOL_EVENT" || current === "CORE_EVENT" || current === "ARC_EVENT") {
    const id = q("screen-event").getAttribute("data-event-id");
    let pick = CONFIG.choices?.[id] ?? (eventIndex % 2 === 0 ? "A" : "B");
    eventIndex++;
    if (q(`choice-${pick}`).disabled) pick = pick === "A" ? "B" : "A";
    return click(`choice-${pick}`);
  }
  if (current === "SCHOOL_OFFERS") return click("offer-0");
  if (current === "FOCUS") {
    const list = CONFIG.focus ?? DEFAULT_FOCUS;
    return click(`focus-${list[focusIndex++ % list.length]}`);
  }
  if (current === "TERM_REVIEW") return click("next-term");
  if (current === "GRAD_PREVIEW") return click("reveal");
  if (current === "GRAD_RESULTS") {
    const masters = CONFIG.masters ? q(`masters-${CONFIG.masters}`) : null;
    if (masters && !masters.disabled) return click(`masters-${CONFIG.masters}`);
    for (const route of ["PHD", "LOCAL_JOB", "HOME_JOB", "TRANSITION"]) {
      const button = q(`route-${route}`);
      if (button && !button.disabled) return click(`route-${route}`);
    }
  }
  throw new Error(`没有可执行的下一步（阶段 ${current}）`);
}

await settle();
await settle();
checkText();

// 用指定种子开局，保证可复现。
await click("seed-toggle");
const input = q("seed-input");
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, String(CONFIG.seed));
input.dispatchEvent(new Event("input", { bubbles: true }));
await settle();
await click("seed-apply");

const stopAt = CONFIG.stopAt ?? "ENDING";
if (stopAt === "SETUP") {
  await click(`family-${CONFIG.economy}`);
  await click(`aspiration-${CONFIG.aspiration}`);
} else {
  for (let guard = 0; guard < 400 && phase() !== stopAt; guard++) {
    measureScreen();
    await step();
  }
  if (phase() !== stopAt) throw new Error(`没有到达 ${stopAt}，停在 ${phase()}`);
}
measureScreen();

const summary = { phase: phase(), clicks, screens, defaultChars, problems };
if (phase() === "ENDING") {
  summary.title = q("ending-title")?.innerText ?? null;
  summary.label = q("ending-label")?.innerText ?? null;
  summary.tier = q("ending-card")?.getAttribute("data-tier") ?? null;
  summary.combo = q("card-combo")?.innerText ?? null;
}
if (phase() === "SCHOOL_OFFERS") {
  summary.tierDrawn = q("tier-drawn")?.innerText ?? null;
  summary.offers = [0, 1, 2].map((i) => q(`offer-${i}`)?.innerText.split("\n")[0] ?? null);
}

// 截图前的收尾动作。
if (CONFIG.after === "expand" && phase() === "ENDING") {
  await click("expand-card-facts");
  await click("toggle-full-review");
  window.scrollTo(0, 0);
} else if (CONFIG.after === "card" && phase() === "ENDING") {
  q("ending-card").scrollIntoView();
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
