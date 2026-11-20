const { createProfileDraft, saveProfileDraft, PROFILE_EXAMPLES, RISK_MIX } = require("../../utils/shared.js");

const groups = [
  { id: "gold", title: "黄金持仓", fields: [
    ["goldGrams", "持有黄金", "克"], ["goldCost", "剩余持仓成本", "元"],
    ["goldPrice", "平台卖出报价", "元/克"], ["goldBudget", "黄金持仓成本上限", "元"],
  ], toggle: "useGoldQuote", toggleLabel: "用国际金价和汇率估算市值", toggleHelp: "行情缺失或两个时间不同步时，使用上方手动报价。晨报仍按上金所收盘价计算。" },
  { id: "fund", title: "万家纳指100 C · 019442", fields: [
    ["fundUnits", "基金份额", "份"], ["fundCost", "剩余持仓成本", "元"], ["fundPrice", "手动单位净值", "元/份"],
  ], toggle: "useFundNav", toggleLabel: "使用最新公布净值", toggleHelp: "按基金披露的净值日估值。" },
  { id: "cash", title: "现金与收支", fields: [
    ["cash", "现金、存款与货币基金", "元"], ["income", "每月税后收入", "元"],
    ["expense", "每月生活与固定支出", "元"], ["monthlyDebt", "每月贷款等还款", "元"],
    ["priorityDebt", "额外优先还款预留", "元"], ["nearTerm", "未来 1—3 年明确用款", "元"],
    ["emergencyMonths", "应急金目标", "个月"], ["maxLoss", "可接受的组合亏损", "元"],
  ], help: "每月支出和每月还款分开填。应急金月数为 0 到 24 的整数。" },
];
const risks = Object.entries(RISK_MIX).map(([id, item]) => ({ id, name: item.name }));

Page({
  data: { ready: false, saving: false, notice: "", groups: [], risks },
  onLoad() {
    const store = getApp().profiles;
    this.stopProfile = store.subscribe(state => {
      if (this.base || state.phase === "starting" || state.busy) return;
      this.base = store.editBase();
      const draft = createProfileDraft(state.profile);
      this.setData({
        ready: true, risk: state.profile.risk,
        groups: groups.map(group => ({
          ...group, checked: group.toggle ? state.profile[group.toggle] : false,
          fields: group.fields.map(([id, label, unit]) => ({ id, label, unit, value: draft[id], example: PROFILE_EXAMPLES[id] })),
        })),
      });
    });
  },
  onUnload() { this.stopProfile?.(); },
  setRisk(event) { this.setData({ risk: event.currentTarget.dataset.id }); },
  toggle(event) {
    const index = event.currentTarget.dataset.index;
    this.setData({ ["groups[" + index + "].checked"]: event.detail.value });
  },
  async save(event) {
    if (!this.base || this.data.saving) return;
    this.setData({ saving: true, notice: "" });
    try {
      const draft = Object.fromEntries(groups.flatMap(group => group.fields).map(([id]) => [id, String(event.detail.value[id] || "")]));
      const options = { risk: this.data.risk };
      for (const group of this.data.groups) if (group.toggle) options[group.toggle] = group.checked;
      const store = getApp().profiles;
      if (await store.save(saveProfileDraft(draft, options), this.base)) {
        wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/holdings/index" }) });
        return;
      }
      this.setData({ notice: store.snapshot().notice || "档案还未保存，请稍后再试。" });
    } catch (error) {
      this.setData({ notice: error.message || "请核对输入。" });
    } finally {
      this.setData({ saving: false });
    }
  },
});
