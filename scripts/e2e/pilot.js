// 端到端自动点击脚本：在真实 WebKit 里走完“首页 → 选天赋 → 分点 → 人生轨迹 → 人生总结”。
// 由 scripts/e2e-webkit.sh 在前面拼上一行
//   const CONFIG = { seed, points?, picks?, runs?, stopAt?, mode?, after?, resume? };
// 再交给 scripts/e2e/snap.swift 执行。返回值是一段 JSON 摘要，由外层脚本检查。
// 只通过 data-testid 找元素、只做点击与输入，不碰游戏内部状态。
//   seed    第一局的种子；多局时后面各局依次加一
//   points  四项点数，缺省 {family:5, academics:5, career:5, wellbeing:5}；总点数比这多时余下的按顺序补到没满的项上
//   picks   选十连抽里的第几张（从 0 起），缺省 [0, 1, 2]
//   runs    连续玩几局（用来检查成就、解锁天赋与继承在多局之间的累计），缺省 1
//   stopAt  停在哪一屏：HOME / TALENTS / ALLOCATE / TIMELINE / SUMMARY（缺省）
//   mode    轨迹怎么看："step" 一段一段点（缺省），"skip" 直接看结局
//   resume  不开新局，只检查页面加载后恢复出来的界面停在 stopAt

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
const screen = () => q("app")?.getAttribute("data-phase") ?? null;

const problems = [];
let clicks = 0;
// 默认界面上实际显示的字数，逐屏累加；用来粗估阅读量，不等于真人计时。
let defaultChars = 0;
const measureScreen = () => {
  defaultChars += (document.querySelector(".screen")?.innerText ?? "").replace(/\s/g, "").length;
};

function checkText() {
  const text = document.body.innerText;
  for (const bad of ["undefined", "NaN", "{{", "}}", "[object", "NOT_IMPLEMENTED"]) {
    if (text.includes(bad)) problems.push(`页面出现 “${bad}”（${screen()}）`);
  }
  if (q("fatal")) problems.push(`出现兜底错误页（${screen()}）`);
}

async function clickElement(element, what) {
  if (!element) throw new Error(`找不到 ${what}（${screen()}）`);
  if (element.disabled) throw new Error(`${what} 被禁用（${screen()}）`);
  element.click();
  clicks++;
  await settle();
  checkText();
}
const click = (id) => clickElement(q(id), id);

const POINT_KEYS = ["family", "academics", "career", "wellbeing"];
const stopAt = CONFIG.stopAt ?? "SUMMARY";
const results = [];

async function startRun(seed) {
  if (screen() === "SUMMARY") await click("play-again");
  if (screen() !== "HOME") {
    const home = q("go-home");
    if (home) await clickElement(home, "go-home");
  }
  if (screen() === "HOME") {
    const input = q("seed-input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, String(seed));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    await click("seed-apply");
  }
  if (screen() !== "TALENTS") throw new Error(`没有进入选天赋（${screen()}）`);
}

async function pickTalents() {
  const cards = all("talent-").filter((element) => element.tagName === "BUTTON");
  if (cards.length !== 10) problems.push(`十连抽出了 ${cards.length} 张`);
  const picked = [];
  for (const index of CONFIG.picks ?? [0, 1, 2]) {
    picked.push(cards[index].getAttribute("data-testid").slice("talent-".length));
    await clickElement(cards[index], `第 ${index} 张天赋`);
  }
  return { drawn: cards.map((card) => card.getAttribute("data-testid").slice("talent-".length)), picked };
}

async function allocate() {
  const want = { family: 5, academics: 5, career: 5, wellbeing: 5, ...(CONFIG.points ?? {}) };
  for (const key of POINT_KEYS) {
    for (let i = 0; i < want[key]; i++) {
      if (q(`point-plus-${key}`).disabled) break;
      await click(`point-plus-${key}`);
    }
  }
  // 有“可分配点数 +N”的天赋时还会剩点：按顺序补到没满的项上，直到分完。
  for (let guard = 0; guard < 40 && q("begin-life").disabled; guard++) {
    const open = POINT_KEYS.map((key) => q(`point-plus-${key}`)).find((button) => !button.disabled);
    if (!open) break;
    await clickElement(open, "补点");
  }
}

async function watchTimeline() {
  if ((CONFIG.mode ?? "step") === "skip") {
    await click("skip-to-end");
  } else {
    for (let guard = 0; guard < 60 && !q("to-summary"); guard++) {
      measureScreen();
      await click("reveal-next");
    }
  }
  if (!q("to-summary")) throw new Error("轨迹没有走到头");
  return all("timeline-entry-").length;
}

function readSummary() {
  const card = q("ending-card");
  return {
    title: q("ending-title")?.innerText ?? null,
    flavor: q("ending-flavor")?.innerText ?? null,
    tier: card?.getAttribute("data-tier") ?? null,
    early: card?.getAttribute("data-early") || null,
    combo: q("card-combo")?.innerText ?? null,
    newAchievements: all("reward-achievement-").length,
    unlockedTalent: q("reward-talent")?.innerText.replace(/\s+/g, " ") ?? null,
  };
}

await settle();
await settle();
checkText();

let seed = CONFIG.seed;
if (CONFIG.resume) {
  // 什么都不点：读档恢复出来的界面必须就是上一次停下的地方。
  if (screen() !== stopAt) throw new Error(`读档后停在 ${screen()}，期望 ${stopAt}`);
} else if (stopAt !== "HOME") {
  for (let run = 0; run < (CONFIG.runs ?? 1); run++, seed++) {
    await startRun(seed);
    if (stopAt === "TALENTS") {
      await pickTalents();
      break;
    }
    const talents = await pickTalents();
    measureScreen();
    await click("to-allocate");
    await allocate();
    if (stopAt === "ALLOCATE") break;
    measureScreen();
    await click("begin-life");
    if (stopAt === "TIMELINE") {
      // 停在轨迹中途：先点几段，留下一个“看到一半”的进度。
      for (let i = 0; i < 4 && q("reveal-next"); i++) await click("reveal-next");
      break;
    }
    const entries = await watchTimeline();
    measureScreen();
    await click("to-summary");
    measureScreen();
    results.push({ seed, entries, picked: talents.picked, ...readSummary() });
  }
}

const summary = { phase: screen(), clicks, defaultChars, problems, runs: results };
// 当前屏的标题、四属性与正文：用来比较“关掉再打开”前后是否完全一样。
summary.stageTitle = q("stage-title")?.innerText ?? null;
summary.stats = q("stat-strip")?.innerText.replace(/\s+/g, " ") ?? null;
summary.screenText = (document.querySelector(".screen")?.innerText ?? "").replace(/\s+/g, " ").slice(0, 400);
// 除开局两步外不该有需要玩家做的选择，也不该有可展开的长文。
summary.expandButtons = document.querySelectorAll("[aria-expanded]").length;

if (CONFIG.after === "gallery") {
  await click("open-gallery");
  summary.galleryProgress = q("gallery-progress")?.innerText.replace(/\s+/g, " ") ?? null;
  window.scrollTo(0, 0);
} else if (CONFIG.after === "card" && q("ending-card")) {
  q("ending-card").scrollIntoView();
} else if (CONFIG.after === "rewards" && q("rewards")) {
  q("rewards").scrollIntoView();
} else if (CONFIG.after === "clear") {
  // 测试收尾：清掉持久化存储里的存档与进度，不给下一次运行留痕迹。
  localStorage.clear();
} else {
  window.scrollTo(0, 0);
}
await settle();
checkText();
return JSON.stringify(summary);
