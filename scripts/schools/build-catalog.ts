// 学校目录构建入口（精选目录）。
//
//   node scripts/schools/build-catalog.ts [--ipeds-dir <目录>] [--offline] [--refresh-evidence]
//
// --ipeds-dir         IPEDS 压缩包所在目录；默认取环境变量 LIUXUE_IPEDS_DIR，否则 ~/Developer/ml_source/datasets/ipeds/2024
// --offline           不联网，只用 data/schools/evidence-verification.json 里的复核缓存；缓存里没有的证据记为 UNVERIFIED
// --refresh-evidence  忽略缓存，把全部证据重新抓取复核
// 默认：缓存里已有结论的不重抓，只补抓新证据和上次因网络失败的证据。
//
// 任何输入解析失败都会在写文件之前中止，不会用空目录覆盖已有的有效产物。

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { emptyCache, QuoteVerifier } from "./lib/evidence.ts";
import type { EvidenceCache } from "./lib/evidence.ts";
import { loadIpedsSnapshot } from "./lib/ipeds.ts";
import { DATA_DIR, runPipeline } from "./lib/pipeline.ts";
import { fetchPage } from "./lib/text.ts";
import { OFFER_TIERS } from "./lib/types.ts";
import type { AliasFile, CatalogManifest, CuratedSchoolFile, OverrideFile, RawEvidenceFile } from "./lib/types.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const ipedsDir = resolve(
  option("--ipeds-dir") ?? process.env.LIUXUE_IPEDS_DIR ?? join(homedir(), "Developer/ml_source/datasets/ipeds/2024"),
);
const offline = flag("--offline");
const refresh = flag("--refresh-evidence");
if (offline && refresh) {
  console.error("--offline 与 --refresh-evidence 不能同时使用。");
  process.exit(2);
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(ROOT, relativePath), "utf8")) as T;
}

function readJsonIfExists<T>(relativePath: string): T | null {
  const path = join(ROOT, relativePath);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** 内容没变就不动文件；有变化时先写临时文件再改名。 */
function writeIfChanged(relativePath: string, content: string): boolean {
  const path = join(ROOT, relativePath);
  if (existsSync(path) && readFileSync(path, "utf8") === content) return false;
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
  return true;
}

const snapshot = loadIpedsSnapshot(ipedsDir);
const curated = readJson<CuratedSchoolFile>(`${DATA_DIR}/curated-schools.json`);
const aliases = readJson<AliasFile>(`${DATA_DIR}/school-aliases.json`);
const overrides = readJson<OverrideFile>(`${DATA_DIR}/eligibility-overrides.json`);

const evidenceDir = join(ROOT, DATA_DIR, "evidence");
const evidenceFiles = (existsSync(evidenceDir) ? readdirSync(evidenceDir) : [])
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => ({ file: `${DATA_DIR}/evidence/${name}`, data: readJson<RawEvidenceFile>(`${DATA_DIR}/evidence/${name}`) }));

const cachePath = `${DATA_DIR}/evidence-verification.json`;
const cache = readJsonIfExists<EvidenceCache>(cachePath) ?? emptyCache();
const verifier = new QuoteVerifier(cache, { offline, refresh, fetcher: (url) => fetchPage(url) });

const outputs = runPipeline({
  snapshot,
  curated,
  aliases,
  overrides,
  evidenceFiles,
  verifier,
  previousManifest: readJsonIfExists<CatalogManifest>(`${DATA_DIR}/manifest.json`),
  now: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
});

const changed: string[] = [];
for (const [relativePath, content] of Object.entries(outputs.files)) {
  if (writeIfChanged(relativePath, content)) changed.push(relativePath);
}
if (!offline && writeIfChanged(cachePath, `${JSON.stringify(outputs.cache, null, 2)}\n`)) changed.push(cachePath);

const { counts, releaseStatus, failedChecks, evidence } = outputs.summary;
console.log(`学校目录（精选）：${counts.eligible} 所  状态 ${releaseStatus}  目录年份 ${snapshot.hdMeta.zipFilename} / ${snapshot.directoryRelease}`);
console.log(`  各池：${OFFER_TIERS.map((tier) => `${tier}=${counts.byTier[tier]}`).join("  ")}`);
console.log(`  依据：已核实 2027 名次 ${counts.verified}  大致区间 ${counts.approximate}  专门院校 ${counts.special}`);
console.log(`  候选 ${counts.candidates}（因资格剔除 ${counts.excluded}，待核 ${counts.reviewRequired}，已核实名次超出范围 ${counts.outOfScopeRank}）`);
console.log(`  证据：通过 ${evidence.verified}  未通过 ${evidence.unverified}  拒收 ${evidence.rejected}（${evidenceFiles.length} 个文件${offline ? "，离线" : ""}）`);
if (failedChecks.length > 0) console.log(`  未通过的检查：${failedChecks.join(", ")}（详见 ${DATA_DIR}/coverage-report.json）`);
console.log(changed.length > 0 ? `  已更新：\n    ${changed.join("\n    ")}` : "  产物无变化。");
