const { buildLearningPlan, readPreferences, LEARNING_SHOCKS } = require("../../utils/shared.js");
const { cny, balancesFor } = require("../../utils/view.js");
const { readSetting, writeSetting, openEditor, openLesson } = require("../../utils/platform.js");

const preferenceKey = "qinglan-planning-v1";
const choices = [
  { id: "horizon", label: "长期资金可能何时使用？", options: [["unknown", "请选择"], ["within3", "3 年内"], ["3to5", "3—5 年"], ["over5", "5 年以上"]] },
  { id: "income", label: "未来收入稳定吗？", options: [["unknown", "请选择"], ["stable", "较稳定"], ["variable", "波动较大"]] },
  { id: "experience", label: "了解这些产品的波动和费用吗？", options: [["unknown", "请选择"], ["learning", "仍在学习"], ["familiar", "已核对主要规则"]] },
];
const categories = [
  { id: "cash", title: "待配置现金" }, { id: "equity", title: "股票类资产" }, { id: "gold", title: "黄金" },
];

Page({
  data: { fields: [], saved: false, shocks: LEARNING_SHOCKS },
  onShow() {
    this.preferences = readPreferences(readSetting(preferenceKey, null));
    const app = getApp();
    this.stopProfile = app.profiles.subscribe(() => this.draw());
    this.stopMarket = app.market.subscribe(() => this.draw());
    void app.market.refresh();
  },
  onHide() { this.stopProfile?.(); this.stopMarket?.(); },
  onUnload() { this.onHide(); },
  draw() {
    const app = getApp();
    const { profile, hasProfile, busy, phase } = app.profiles.snapshot();
    const { balances } = balancesFor(profile, app.market.snapshot().market);
    const plan = buildLearningPlan(profile, balances, this.preferences, this.data.shocks);
    const amount = value => cny(value, app.privacy);
    let status = "比较扣除预留后的资金安排";
    if (plan.missing.length) status = "待补齐 " + plan.missing.join("、");
    else if (profile.expense + profile.monthlyDebt <= 0) status = "待核对每月必要支出";
    else if (balances.monthlyDeficit > 0) status = "先处理每月现金流缺口";
    else if (balances.reserveGap > 0) status = "先补齐应急金和明确用款";
    else if (balances.longTerm <= 0) status = "当前资金优先覆盖预留";
    this.setData({
      fields: choices.map(({ id, label, options }) => {
        const index = options.findIndex(option => option[0] === this.preferences[id]);
        return { id, label, index, labels: options.map(option => option[1]), value: options[index][1] };
      }),
      busy: busy || phase === "starting", saved: hasProfile, status, blocked: plan.blocked, reasons: plan.reasons,
      reserve: amount(balances.reserve), reserveGap: amount(balances.reserveGap), needsReserve: balances.reserveGap > 0,
      longTerm: amount(balances.longTerm), surplus: amount(balances.surplus),
      monthlyReserve: amount(plan.monthly.reserve), monthsToReserve: plan.monthsToReserve,
      target: categories.map(item => ({ ...item, total: amount(plan.target[item.id]), monthly: amount(plan.monthly[item.id]) })),
      budget: amount(profile.maxLoss), currentStress: amount(plan.currentStress), targetStress: amount(plan.targetStress),
      exceeds: plan.currentStress > profile.maxLoss,
    });
  },
  preference(event) {
    const field = choices.find(item => item.id === event.currentTarget.dataset.id);
    if (!field) return;
    this.preferences = readPreferences({ ...this.preferences, [field.id]: field.options[Number(event.detail.value)]?.[0] });
    writeSetting(preferenceKey, this.preferences);
    this.draw();
  },
  shock(event) {
    const { key } = event.currentTarget.dataset;
    const value = Number(event.detail.value);
    if (key !== "gold" && key !== "equity" || !Number.isFinite(value)) return;
    this.setData({ ["shocks." + key]: value });
    this.draw();
  },
  openEditor, openLesson,
});
