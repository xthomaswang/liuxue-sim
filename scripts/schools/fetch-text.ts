// 证据检索用的小工具：抓取一个 URL，输出规范化后的正文，或检查一段引文能否被复核。
//
//   node scripts/schools/fetch-text.ts <url>                     打印状态行和全文
//   node scripts/schools/fetch-text.ts <url> --grep "No\\. ?\\d+" 打印每处匹配及前后文（可用 --context N 调整）
//   node scripts/schools/fetch-text.ts <url> --check "引文"        引文能否匹配，退出码 0/1
//
// 摘录引文时，直接从这里的输出里复制一段连续文字，复核脚本用的是同一套规范化。

import { containsQuote, fetchPage, normalizeForMatch } from "./lib/text.ts";

const args = process.argv.slice(2);
const url = args[0];
if (!url || url.startsWith("--")) {
  console.error("用法：node scripts/schools/fetch-text.ts <url> [--grep 正则] [--context 字符数] [--check 引文]");
  process.exit(2);
}
function option(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

let page;
try {
  page = fetchPage(url);
} catch (error) {
  console.error(`FETCH_FAILED ${url}\n${(error as Error).message}`);
  process.exit(3);
}
console.log(
  `# status=${page.httpStatus} bytes=${page.bytes} chars=${page.text.length} sha256=${page.sha256}\n# finalUrl=${page.finalUrl}\n# fetchedAt=${page.fetchedAt}`,
);

const check = option("--check");
const grep = option("--grep");
if (check !== undefined) {
  const ok = page.httpStatus >= 200 && page.httpStatus < 300 && containsQuote(page.text, check);
  console.log(ok ? "MATCH" : "NO_MATCH");
  console.log(`# normalizedQuote=${normalizeForMatch(check)}`);
  process.exit(ok ? 0 : 1);
} else if (grep !== undefined) {
  const context = Number(option("--context") ?? 160);
  const pattern = new RegExp(grep, "gi");
  let count = 0;
  for (const match of page.text.matchAll(pattern)) {
    const start = Math.max(0, match.index - context);
    const end = Math.min(page.text.length, match.index + match[0].length + context);
    console.log(`--- [${match.index}] ${page.text.slice(start, end)}`);
    if (++count >= 60) break;
  }
  console.log(`# matches=${count}`);
} else {
  console.log(page.text);
}
