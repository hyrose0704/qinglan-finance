import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

function dpapi(input, decrypt = false) {
  const operation = decrypt ? "Unprotect" : "Protect";
  const script = `Add-Type -AssemblyName System.Security; $vaultInput=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Console]::Out.Write([Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::${operation}($vaultInput,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)))`;
  return new Promise((resolve, reject) => {
    const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const child = spawn(executable, ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("本机凭证保护服务超时。")); }, 15000);
    child.stdout.on("data", chunk => { output += chunk; if (output.length > 2_000_000) child.kill(); });
    child.once("error", () => { clearTimeout(timer); reject(new Error("无法使用 Windows 本机凭证保护服务。")); });
    child.stdin.on("error", () => {});
    child.once("close", code => { clearTimeout(timer); code === 0 ? resolve(Buffer.from(output.trim(), "base64")) : reject(new Error("本机凭证保护失败，请使用同一 Windows 用户启动。")); });
    child.stdin.end(input.toString("base64"));
  });
}

export class AccountStore {
  constructor(directory = path.join(process.env.LOCALAPPDATA || path.join(homedir(), ".local", "share"), "QinglanFinance", "local-assistant")) {
    this.directory = path.resolve(directory); this.file = path.join(this.directory, "accounts.json"); this.queue = Promise.resolve();
  }
  async read() {
    try {
      const raw = await readFile(this.file, "utf8");
      if (raw.length > 2_000_000) throw new Error();
      const envelope = JSON.parse(raw);
      const data = envelope.protection === "dpapi" ? JSON.parse((await dpapi(Buffer.from(envelope.data, "base64"), true)).toString("utf8")) : envelope.data;
      if (envelope.version !== 1 || !data || typeof data.hostId !== "string" || !Array.isArray(data.accounts)) throw new Error();
      return data;
    } catch (error) {
      if (error.code === "ENOENT") return { hostId: `urn:uuid:${randomUUID()}`, accounts: [] };
      throw new Error("无法读取本机账号记录，请检查运行用户和本机存储权限。");
    }
  }
  async write(data) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const protectedData = process.platform === "win32" ? { protection: "dpapi", data: (await dpapi(Buffer.from(JSON.stringify(data)))).toString("base64") } : { protection: "owner-only-file", data };
    const temporary = path.join(this.directory, `accounts-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify({ version: 1, ...protectedData }), { mode: 0o600 });
    await rename(temporary, this.file);
  }
  update(change) {
    const operation = this.queue.then(async () => {
      const data = await this.read(); const result = await change(data); await this.write(data); return result;
    });
    this.queue = operation.catch(() => {}); return operation;
  }
  initialize() { return this.update(data => data.hostId); }
}
