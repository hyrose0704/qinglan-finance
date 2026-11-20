const { mergeBriefArchives, readBriefArchive } = require("./shared.js");

function checkedMarket(value) {
  if (!value || !Array.isArray(value.quotes) || !Number.isFinite(Date.parse(value.fetchedAt))) return null;
  return value;
}

function moreRecent(older, other) {
  return other && (!older || Date.parse(other.fetchedAt) >= Date.parse(older.fetchedAt)) ? other : older;
}

function createMarketStore(published, request, readSetting, writeSetting) {
  const publicDataKey = "qinglan-public-market-v1";
  const listeners = new Set();
  const saved = readSetting(publicDataKey, null);
  const cachedBrief = readBriefArchive(saved?.brief, Date.now());
  let state = {
    brief: mergeBriefArchives([published.brief, cachedBrief]),
    market: moreRecent(checkedMarket(published.snapshot), checkedMarket(saved?.market)),
    status: cachedBrief?.editions.length ? "cached" : "snapshot", loading: false, warning: "",
  };
  let pending = null;
  let lastRead = 0;

  function emit(patch) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  }

  async function refresh(force = false) {
    if (pending) return pending;
    if (!force && Date.now() - lastRead < 60000) return;
    emit({ loading: true });
    pending = (async () => {
      const version = "?minute=" + Math.floor(Date.now() / 60000);
      const [briefResult, marketResult] = await Promise.allSettled([
        request(published.marketBase + "brief.json" + version),
        request(published.marketBase + "market.json" + version),
      ]);
      const brief = briefResult.status === "fulfilled" ? readBriefArchive(briefResult.value, Date.now()) : null;
      const market = marketResult.status === "fulfilled" ? checkedMarket(marketResult.value) : null;
      const warning = !brief?.editions.length && !market ? "暂未连上青览行情，当前保留最近可用的有日期数据。"
        : !brief?.editions.length ? "晨报暂未更新，当前保留上一次内容。" : !market ? "行情快照暂未更新。" : "";
      lastRead = Date.now();
      const next = {
        brief: mergeBriefArchives([state.brief, brief]), market: moreRecent(state.market, market),
        loading: false, status: brief?.editions.length ? "published" : state.status, warning,
      };
      if (brief?.editions.length || market) writeSetting(publicDataKey, { brief: next.brief, market: next.market });
      emit(next);
    })().finally(() => { pending = null; });
    return pending;
  }

  return {
    refresh, snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
  };
}

module.exports = { createMarketStore };
