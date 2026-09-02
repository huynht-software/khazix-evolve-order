/** Small terminal + env helpers, so the tool needs no dependencies. */

import fs from "node:fs";
import path from "node:path";

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;
const colorEnabled = !process.env.NO_COLOR && process.stdout.isTTY !== false;

const wrap = (code, text) => (colorEnabled ? `\u001b[${code}m${text}\u001b[0m` : String(text));

export const color = {
  bold: (t) => wrap(1, t),
  dim: (t) => wrap(2, t),
  red: (t) => wrap(31, t),
  green: (t) => wrap(32, t),
  yellow: (t) => wrap(33, t),
  cyan: (t) => wrap(36, t),
};

export const visibleLength = (text) => String(text).replace(ANSI_PATTERN, "").length;

function pad(text, width, align) {
  const filler = " ".repeat(Math.max(0, width - visibleLength(text)));
  return align === "right" ? filler + text : text + filler;
}

/**
 * Render a box-drawn table.
 * @param {{title?: string, columns: Array<{header: string, align?: "left"|"right"}>, rows: string[][]}} spec
 */
export function renderTable({ title, columns, rows }) {
  const widths = columns.map((column, index) =>
    Math.max(visibleLength(column.header), ...rows.map((row) => visibleLength(row[index] ?? "")), 0),
  );

  const line = (left, mid, right) =>
    left + widths.map((width) => "─".repeat(width + 2)).join(mid) + right;
  const rowText = (cells) =>
    "│ " + cells.map((cell, i) => pad(cell ?? "", widths[i], columns[i].align)).join(" │ ") + " │";

  const out = [];
  if (title) out.push(color.bold(title));
  out.push(line("┌", "┬", "┐"));
  out.push(rowText(columns.map((column) => color.bold(column.header))));
  out.push(line("├", "┼", "┤"));
  for (const row of rows) out.push(rowText(row));
  out.push(line("└", "┴", "┘"));
  return out.join("\n");
}

/** Minimal .env reader; avoids needing the --env-file flag at the call site. */
export function loadEnv(file = ".env") {
  const target = path.resolve(file);
  if (!fs.existsSync(target)) return;

  for (const rawLine of fs.readFileSync(target, "utf8").split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["'](.*)["']$/, "$1");
    if (!(key in process.env)) process.env[key] = value;
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function progress(message) {
  if (process.stderr.isTTY) {
    process.stderr.write(`\r\u001b[K${message}`);
  }
}

export function progressDone() {
  if (process.stderr.isTTY) process.stderr.write("\r\u001b[K");
}
