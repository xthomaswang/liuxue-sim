// 排名证据的抓取与文本规范化。
// 证据复核标准只有一条：用本文件重新抓取来源 URL，规范化后的页面正文必须包含规范化后的引文。
// 检索证据的人和最终复核脚本共用这里的函数，保证“摘录时能匹配”与“复核时能匹配”是同一件事。
// 只用 Node 内置模块；Node 24 可直接运行（类型会被剥离）。

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

export interface FetchedPage {
  url: string;
  finalUrl: string;
  httpStatus: number;
  contentType: string;
  bytes: number;
  sha256: string;
  fetchedAt: string;
  /** htmlToText() 的结果，已规范化。 */
  text: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', sbquo: "'", bdquo: '"',
  ndash: "-", mdash: "-", minus: "-", hyphen: "-", hellip: "...",
  copy: "(c)", reg: "(R)", trade: "(TM)", middot: "·", bull: "•",
  eacute: "é", egrave: "è", aacute: "á", agrave: "à", iacute: "í", oacute: "ó",
  uacute: "ú", ntilde: "ñ", uuml: "ü", ouml: "ö", auml: "ä", ccedil: "ç",
  Eacute: "É", Ntilde: "Ñ", thinsp: " ", ensp: " ", emsp: " ", zwnj: "", zwj: "",
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : whole;
  });
}

/** 匹配用的规范化：NFKC、统一引号与连字符、去零宽字符、折叠空白。保留大小写。 */
export function normalizeForMatch(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[‘’‚‛′´`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/[​‌‍⁠﻿­]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 把 HTML 变成可检索的纯文本：去掉脚本/样式/注释，标签换成空格，解码实体，再规范化。 */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  return normalizeForMatch(decodeEntities(stripped));
}

/** 引文是否出现在页面正文里（两边都规范化，忽略大小写）。 */
export function containsQuote(pageText: string, quote: string): boolean {
  const needle = normalizeForMatch(quote).toLowerCase();
  if (needle.length === 0) return false;
  return normalizeForMatch(pageText).toLowerCase().includes(needle);
}

function decodeBody(body: Buffer, contentType: string): string {
  const header = /charset=["']?([A-Za-z0-9_-]+)/i.exec(contentType)?.[1];
  const meta = /<meta[^>]+charset=["']?([A-Za-z0-9_-]+)/i.exec(body.subarray(0, 4096).toString("latin1"))?.[1];
  const charset = (header ?? meta ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

/** 用 curl 抓取页面。网络失败时抛错；HTTP 非 2xx 不抛错，由调用方看 httpStatus。 */
export function fetchPage(url: string, timeoutSeconds = 45): FetchedPage {
  const dir = mkdtempSync(join(tmpdir(), "liuxue-evidence-"));
  const bodyPath = join(dir, "body");
  try {
    const meta = execFileSync(
      "curl",
      [
        "-sS", "-L", "--compressed", "-m", String(timeoutSeconds),
        "-A", USER_AGENT,
        "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "-H", "Accept-Language: en-US,en;q=0.9",
        "-o", bodyPath,
        "-w", "%{http_code}\t%{url_effective}\t%{content_type}",
        url,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const [status, finalUrl, contentType] = meta.split("\t");
    const body = readFileSync(bodyPath);
    return {
      url,
      finalUrl: finalUrl || url,
      httpStatus: Number(status),
      contentType: contentType ?? "",
      bytes: body.length,
      sha256: createHash("sha256").update(body).digest("hex"),
      fetchedAt: new Date().toISOString(),
      text: htmlToText(decodeBody(body, contentType ?? "")),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
