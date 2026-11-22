// Prints the Vitest coverage summary as a Markdown table (used for the CI job summary).
import { readFileSync } from "node:fs";

const total = JSON.parse(readFileSync("coverage/coverage-summary.json", "utf8")).total;
const rows = ["lines", "statements", "branches", "functions"].map((k) => `| ${k} | ${total[k].pct}% | ${total[k].covered}/${total[k].total} |`);
console.log(["### Coverage (server code)", "| Metric | % | Covered |", "|---|---|---|", ...rows].join("\n"));
