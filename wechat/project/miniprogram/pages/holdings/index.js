const { number, quantity, cny, balancesFor, signedMoney } = require("../../utils/view.js");
const { openAccount, openEditor } = require("../../utils/platform.js");

function hasField(profile, field) {
  return profile.filledFields ? profile.filledFields.includes(field) : true;
}

Page({
  data: { rows: [] },
  onShow() {
    const app = getApp();
    this.stopProfile = app.profiles.subscribe(() => this.draw());
    this.stopMarket = app.market.subscribe(() => this.draw());
    void app.market.refresh();
  },
  onHide() { this.stopProfile?.(); this.stopMarket?.(); },
  onUnload() { this.onHide(); },
  draw() {
    const app = getApp();
    const state = app.profiles.snapshot();
    const privacy = app.privacy;
    const profile = state.profile;
    const market = app.market.snapshot().market;
    const { balances, prices } = balancesFor(profile, market);
    const configured = [
      { id: "gold", title: "黄金", field: "goldGrams", cost: "goldCost", unit: "克", digits: 2, price: balances.goldPrice,
        value: balances.goldValue, basis: profile.useGoldQuote && prices.gold ? "国际金价与汇率折算" : "平台手动报价" },
      { id: "fund", title: "万家纳指100 C · 019442", field: "fundUnits", cost: "fundCost", unit: "份", digits: 4, price: balances.fundPrice,
        value: balances.fundValue, basis: profile.useFundNav && prices.fund ? "净值日 " + market.fund.date : "手动单位净值" },
    ];
    const rows = configured.map(item => {
      const qty = profile[item.field];
      const valueKnown = hasField(profile, item.field) && (qty === 0 || item.price > 0);
      const hasCost = hasField(profile, item.cost);
      return {
        id: item.id, title: item.title, quantity: privacy ? "••••" : hasField(profile, item.field) ? quantity(qty) + " " + item.unit : "待填写",
        price: privacy ? "••••" : item.price > 0 ? number(item.price, item.digits) + " 元/" + item.unit : "待补",
        basis: item.basis, value: valueKnown ? cny(item.value, privacy) : "待核算",
        cost: hasCost ? cny(profile[item.cost], privacy) : "待填写",
        pnl: valueKnown && hasCost ? privacy ? "••••" : signedMoney(item.value - profile[item.cost]) : "待核算",
      };
    });
    this.setData({
      rows: state.hasProfile ? rows : [], saved: state.hasProfile, privacy,
      busy: state.busy || state.phase === "starting",
      total: state.hasProfile ? cny(balances.total, privacy) : "—",
      partial: configured.some(item => !hasField(profile, item.field) || profile[item.field] > 0 && item.price <= 0) || !hasField(profile, "cash"),
      cash: hasField(profile, "cash") ? cny(profile.cash, privacy) : "待填写",
      notice: state.notice, account: state.signedIn
        ? state.phase === "ready" && state.revision > 0 ? "云端第 " + state.revision + " 版" : "青览账号已登录"
        : "这台设备",
    });
  },
  async onPullDownRefresh() {
    try { await Promise.all([getApp().market.refresh(true), getApp().profiles.refresh()]); }
    finally { wx.stopPullDownRefresh(); }
  },
  openEditor, openAccount,
});
