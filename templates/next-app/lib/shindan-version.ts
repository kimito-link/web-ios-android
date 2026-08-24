import { readFile } from "node:fs/promises";
import path from "node:path";

export type ShindanStatus = "pass" | "warning" | "fail" | "unmeasured";
export type ShindanCheck = {
  label: string;
  status: ShindanStatus;
  evidence: string;
  nextAction?: string;
};
export type ShindanStage = {
  id: string;
  title: string;
  summary: string;
  status: ShindanStatus;
  completed: number;
  total: number;
  percent: number;
  checks: ShindanCheck[];
};
export type ShindanReport = {
  generatedAtLabel: string;
  commit: string;
  app: {
    name: string;
    version: string;
    homeUrl: string;
    diagnosisUrl: string;
    primaryColor: string;
    accentColor: string;
  };
  progress: { completed: number; total: number; percent: number };
  counts: { pass: number; warning: number; fail: number; unmeasured: number };
  stages: ShindanStage[];
  evolution: {
    latest: Array<{ version: string; label: string; value: string | number; unit: string }>;
    publicLatest?: Array<{ version: string; label: string; value: string | number; unit: string }>;
  };
};

const reportPath = path.join(process.cwd(), "public", "check-shindan-version", "report.json");
const reportPromise = readFile(reportPath, "utf8").then((source) => JSON.parse(source) as ShindanReport);

export function loadShindanVersionReport(): Promise<ShindanReport> {
  return reportPromise;
}
