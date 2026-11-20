import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { parseCloudConfig } from "../lib/cloud-profile.ts";
import { readBriefArchive } from "../lib/morning-brief.ts";

const repo = fileURLToPath(new URL("../", import.meta.url));
const defaultMarketBase = "https://hyrose0704.github.io/qinglan-finance/";

async function json(path) {
  return JSON.parse((await readFile(join(repo, path), "utf8")).replace(/^\uFEFF/, ""));
}

function endpoint(value, name, rootOnly = false) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.includes(".") || url.port || url.username || url.password || url.search || url.hash
    || rootOnly && url.pathname !== "/") throw new Error("Expected a public HTTPS endpoint for " + name);
  return rootOnly ? url.origin : url.href.replace(/\/?$/, "/");
}

export async function buildWeChatProject(outDirectory) {
  const output = resolve(outDirectory);
  const project = join(repo, "wechat", "project");
  const runtime = join(output, "miniprogram");
  const config = parseCloudConfig(await json("public/data/cloud-config.json"));
  if (!config) throw new Error("Missing the public cloud configuration");
  const marketBase = endpoint(process.env.QINGLAN_WECHAT_MARKET_BASE || defaultMarketBase, "QINGLAN_WECHAT_MARKET_BASE");
  const cloudUrl = endpoint(process.env.QINGLAN_WECHAT_CLOUD_ORIGIN || config.url, "QINGLAN_WECHAT_CLOUD_ORIGIN", true);
  const snapshot = await json("public/market.json");
  const brief = readBriefArchive(await json("public/brief.json"), Date.now());

  await mkdir(output, { recursive: true });
  await cp(project, output, {
    recursive: true,
    filter: file => !/(?:^|[/\\])(?:project\.private\.config\.json|node_modules)(?:$|[/\\])/.test(file),
  });
  await cp(join(repo, "docs", "wechat-mini-program.md"), join(output, "START-HERE.md"));
  await mkdir(join(runtime, "data"), { recursive: true });
  await writeFile(join(runtime, "data", "published.js"), "module.exports = " + JSON.stringify({
    marketBase, cloud: { ...config, url: cloudUrl }, snapshot, brief,
  }) + ";\n");

  await build({
    root: repo,
    configFile: false,
    publicDir: false,
    logLevel: "warn",
    build: {
      lib: { entry: join(repo, "wechat", "shared.ts"), formats: ["cjs"], fileName: () => "shared.js" },
      outDir: join(runtime, "utils"),
      target: "es2019",
      emptyOutDir: false,
    },
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = join(repo, "dist-wechat");
  await buildWeChatProject(output);
  console.log(`WeChat project ready in ${output}`);
}
