import os from "node:os";
import path from "node:path";
import { readFile, mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
export const PRIORITIES = Object.freeze({
  low: os.constants.priority.PRIORITY_LOW,
  "below-normal": os.constants.priority.PRIORITY_BELOW_NORMAL,
  normal: os.constants.priority.PRIORITY_NORMAL,
  "above-normal": os.constants.priority.PRIORITY_ABOVE_NORMAL,
  high: os.constants.priority.PRIORITY_HIGH
});
const ENTRY = /(?:^|[\\/\s"])(?:train-adaptive-policy-q|train-neural-ai|train-ai|bootstrap-neural-ai|run-bootstrap-ai|collect-ai-shard|ai-selfplay-worker-process|ai-action-audit-worker-process|evaluator-bootstrap-stage-process|detached-action-audit-coordinator)\.(?:mjs|cjs)(?=[\s"]|$)/i;

// Scope by this checkout before following descendants. Never select every Node process.
export function selectTrainingProcesses(processes, projectRoot) {
  const root = path.resolve(projectRoot).replaceAll("\\", "/").toLowerCase();
  const selected = new Set();
  for (const p of processes) {
    const command = String(p.commandLine || "");
    if (command.replaceAll("\\", "/").toLowerCase().includes(`${root}/`) && ENTRY.test(command)) selected.add(p.pid);
  }
  let changed;
  do {
    changed = false;
    for (const p of processes) {
      if (selected.has(p.parentPid) && !selected.has(p.pid)) {
        selected.add(p.pid); changed = true;
      }
      // npm/direct launches may use relative entrypoint and config paths.
      // An absolute-path project worker supplies the missing checkout evidence
      // for its training controller, without adopting a shell or game server.
      if (selected.has(p.pid) && !selected.has(p.parentPid)) {
        const parent = processes.find(candidate => candidate.pid === p.parentPid);
        if (parent && ENTRY.test(String(parent.commandLine || ""))) { selected.add(parent.pid); changed = true; }
      }
    }
  } while (changed);
  return processes.filter(p => selected.has(p.pid));
}

export async function listNodeProcesses() {
  if (process.platform !== "win32") return [];
  const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | ForEach-Object { [PSCustomObject]@{pid=$_.ProcessId;parentPid=$_.ParentProcessId;commandLine=$_.CommandLine} }) | ConvertTo-Json -Compress"],
  { windowsHide: true, timeout: 12000, maxBuffer: 2 * 1024 * 1024 });
  const parsed = JSON.parse(stdout.replace(/^\uFEFF/, "") || "[]");
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function createPriorityController({ projectRoot, settingsFile = path.join(projectRoot, "data/ai/process-priority.json"),
  listProcesses = listNodeProcesses, getPriority = os.getPriority, setPriority = os.setPriority,
  supported = process.platform === "win32" }) {
  let processes = [], last = { requested: null, supported, processes: [], errors: [] }, queue = Promise.resolve();
  const serial = action => { const next = queue.then(action); queue = next.catch(() => {}); return next; };
  const readSetting = async () => {
    try {
      const value = JSON.parse((await readFile(settingsFile, "utf8")).replace(/^\uFEFF/, ""));
      return Object.hasOwn(PRIORITIES, value.priority) ? value.priority : null;
    } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  };
  async function reconcile() {
    const requested = await readSetting();
    processes = supported ? selectTrainingProcesses(await listProcesses(), projectRoot) : [];
    const report = [], errors = [];
    for (const p of processes) {
      try {
        if (requested && getPriority(p.pid) !== PRIORITIES[requested]) setPriority(p.pid, PRIORITIES[requested]);
        const actual = getPriority(p.pid);
        const priority = Object.keys(PRIORITIES).find(key => PRIORITIES[key] === actual) || String(actual);
        report.push({ pid: p.pid, priority });
        if (requested && actual !== PRIORITIES[requested]) errors.push({ pid: p.pid, message: "요청한 우선순위가 적용되지 않았습니다. 실행 권한을 확인해 주세요." });
      } catch (error) {
        // A worker can exit between enumeration and the OS call.
        if (error.code !== "ESRCH" && error.info?.code !== "ESRCH") errors.push({ pid: p.pid, message: error.message });
      }
    }
    last = { requested, supported, processes: report, errors, checkedAt: new Date().toISOString(),
      inheritedByNewProcesses: Boolean(requested) };
    return last;
  }
  return {
    get processes() { return processes; },
    get status() { return last; },
    refresh: () => serial(reconcile),
    set: priority => serial(async () => {
      if (!supported) throw new Error("우선순위 변경은 Windows에서 지원합니다.");
      if (!Object.hasOwn(PRIORITIES, priority)) throw new Error("지원하지 않는 우선순위입니다.");
      await mkdir(path.dirname(settingsFile), { recursive: true });
      const temporary = `${settingsFile}.${process.pid}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ priority, updatedAt: new Date().toISOString() }) + "\n");
        await rename(temporary, settingsFile);
      } finally { await unlink(temporary).catch(() => {}); }
      return reconcile();
    })
  };
}
