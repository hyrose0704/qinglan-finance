const { compoundScenario, qdiiScenario, recoveryReturn, EQUITY_CASE, compareEquityScenarios, signedChange } = require("../../utils/shared.js");
const { number } = require("../../utils/view.js");

const experiments = {
  compound: { title: "复利与费用", fields: [
    ["principal", "起始金额", "元", 0, 100000, 1000, 10000], ["monthly", "每月投入", "元", 0, 10000, 100, 1000],
    ["annualReturn", "假设年收益率", "%", -10, 15, 1, 6], ["fee", "假设年费率", "%", 0, 3, 0.1, 0.8],
    ["years", "持有年限", "年", 1, 30, 1, 10],
  ] },
  currency: { title: "QDII 汇率", fields: [
    ["equity", "海外资产涨跌", "%", -40, 40, 1, 10], ["currency", "美元兑人民币涨跌", "%", -20, 20, 1, -5],
  ] },
  recovery: { title: "亏损与回本", fields: [["loss", "下跌幅度", "%", 0, 95, 1, 20]] },
  valuation: { title: "盈利与估值", fields: [
    ["margin", "基准净利率", "%", EQUITY_CASE.margin.min, EQUITY_CASE.margin.max, 1, EQUITY_CASE.margin.initial],
    ["multiple", "基准市盈率", "倍", EQUITY_CASE.multiple.min, EQUITY_CASE.multiple.max, 1, EQUITY_CASE.multiple.initial],
  ] },
};

function runExperiment(mode, values) {
  switch (mode) {
    case "compound": {
      const result = compoundScenario(values.principal, values.monthly, values.annualReturn, values.fee, values.years);
      return { headline: "假设期末金额", result: "¥" + number(result.value),
        note: "累计投入 ¥" + number(result.contributed) + "。以相同年收益和费率折算为月收益，再计入每月末投入。" };
    }
    case "currency":
      return { headline: "人民币口径假设涨跌", result: signedChange(qdiiScenario(values.equity, values.currency)),
        note: "把海外涨跌因子与汇率涨跌因子相乘，再减 1。基金真实净值还受估值时点、跟踪偏差和费用影响。" };
    case "recovery":
      return { headline: "回到起点所需涨幅", result: number(recoveryReturn(values.loss)) + "%",
        note: "先用 100 元减去损失，再用需要赚回的金额除以剩余金额。" };
    case "valuation": {
      const example = compareEquityScenarios(values.margin, values.multiple);
      return {
        headline: "基准情景参考价", result: example.base.price === null ? "盈利非正，倍数法待用" : number(example.base.price) + " 元",
        scenarios: [
          ["下行情景", example.downside], ["基准情景", example.base], ["上行情景", example.upside],
        ].map(([label, row]) => ({
          label, inputs: row.margin + "% × " + row.multiple + " 倍", value: row.price === null ? "待估" : number(row.price) + " 元",
        })),
        note: "虚构公司收入 20 亿元、稀释股数 1 亿股。若参考价为 32 元，当前倍数需要约 "
          + number(example.requiredMargin) + "% 的净利率。倍数法还需核对可比公司的增长和风险。",
      };
    }
  }
}

Page({
  data: { modes: Object.entries(experiments).map(([id, item]) => ({ id, title: item.title })), fields: [] },
  onLoad(query) { this.select(Object.prototype.hasOwnProperty.call(experiments, query.mode) ? query.mode : "compound"); },
  select(mode) {
    const fields = experiments[mode].fields.map(([id, label, unit, min, max, step, value]) => ({ id, label, unit, min, max, step, value }));
    this.setData({ mode, fields });
    this.draw(fields);
  },
  draw(fields) {
    const values = Object.fromEntries(fields.map(item => [item.id, item.value]));
    this.setData({ result: runExperiment(this.data.mode, values) });
  },
  changeMode(event) { this.select(event.currentTarget.dataset.id); },
  change(event) {
    const id = event.currentTarget.dataset.id;
    const value = Number(event.detail.value);
    const fields = this.data.fields.map(field => field.id === id && Number.isFinite(value) && value >= field.min && value <= field.max
      ? { ...field, value } : field);
    this.setData({ fields });
    this.draw(fields);
  },
});
