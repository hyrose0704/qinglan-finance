import { useState, type ComponentType, type ReactNode } from "react";
import { Check, Coins, TrendingUp, Wallet } from "lucide-react";
import type { NumericProfileField, Profile } from "@/lib/finance";
import { createProfileDraft, PROFILE_EXAMPLES, saveProfileDraft, type ProfileDraft } from "@/lib/profile-form";

interface Props {
  profile: Profile;
  save: (profile: Profile) => Promise<boolean>;
  close: () => void;
  Modal: ComponentType<{ title: string; children: ReactNode; close: () => void; wide?: boolean }>;
}

export function AssetEditor({ profile, save, close, Modal }: Props) {
  const [draft, setDraft] = useState<ProfileDraft>(() => createProfileDraft(profile));
  const [options, setOptions] = useState({ risk: profile.risk,
    useGoldQuote: profile.mode === "personal" && profile.useGoldQuote,
    useFundNav: profile.mode === "personal" && profile.useFundNav });
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const blankCount = Object.values(draft).filter(value => !value.trim()).length;
  function field(key: NumericProfileField, label: string, unit = "元", help?: string) {
    return <label className="field"><span>{label}</span><div className="input-wrap">
      <input name={key} aria-label={label} type="number" min="0" max={key === "emergencyMonths" ? "24" : "100000000000"}
        step={key === "emergencyMonths" ? "1" : "any"} placeholder={PROFILE_EXAMPLES[key]} value={draft[key]} disabled={saving}
        onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))} /><span>{unit}</span>
    </div>{help && <small>{help}</small>}</label>;
  }
  return <Modal title="建立我的资金档案" close={close} wide>
    <p className="form-help">灰色文字是填写示例，不是默认金额。未填写的数值保存时按0记录；再次编辑时仍保留空白。已保存的个人数值会正常回填。</p>
    <form onSubmit={async event => { event.preventDefault(); if (saving) return; setSaving(true); try {
      if (!await save(saveProfileDraft(draft, options))) setNotice("未能确认保存，请保持本页并重试，或先导出备份。");
    } catch (error) { setNotice(error instanceof Error ? error.message : "请核对输入。"); } finally { setSaving(false); } }}>
      <div className="form-section"><h3><Wallet size={18} />资金与收支</h3><div className="form-grid">
        {field("cash", "现金、存款与货币基金", "元", "不含下方单独录入的黄金和基金")}
        {field("income", "每月税后收入")}{field("expense", "每月生活与固定支出", "元", "不含单独填入的每月还款")}
        {field("monthlyDebt", "每月贷款等还款")}{field("priorityDebt", "额外优先还款预留", "元", "一次性预留，勿与每月还款重复")}
        {field("nearTerm", "未来1—3年明确用款", "元", "不与应急金重复")}
        {field("emergencyMonths", "应急金目标", "个月", "0至24个月；留空按0保存，之后需核对预留安排")}
        {field("maxLoss", "可接受的组合亏损", "元", "用于比较情景，不是市场亏损上限")}
      </div></div>
      <div className="form-section"><h3><Coins size={18} />黄金持仓</h3><div className="form-grid">
        {field("goldGrams", "持有黄金", "克")}{field("goldCost", "黄金剩余持仓实际成本")}
        {field("goldPrice", "平台当前卖出报价", "元/克")}{field("goldBudget", "黄金持仓成本上限")}
      </div><label className="check-row"><input type="checkbox" checked={options.useGoldQuote}
        onChange={event => setOptions(previous => ({ ...previous, useGoldQuote: event.target.checked }))} />
        <span>使用国际金价 × 汇率估算市值<small>仅理论折算，不含境内溢价、平台点差及赎回费；行情过期时用手动价。</small></span></label></div>
      <div className="form-section"><h3><TrendingUp size={18} />万家纳指100 C · 019442</h3><div className="form-grid">
        {field("fundUnits", "基金份额", "份")}{field("fundCost", "基金剩余持仓实际成本")}{field("fundPrice", "手动单位净值", "元/份")}
      </div><label className="check-row"><input type="checkbox" checked={options.useFundNav}
        onChange={event => setOptions(previous => ({ ...previous, useFundNav: event.target.checked }))} />
        <span>使用最新公布基金净值<small>净值按所属日期估值，不是盘中成交价格。</small></span></label></div>
      <p className="form-help">{blankCount ? `有 ${blankCount} 项数值未填写，保存后按0计算。0不代表已确认没有这项资产、支出或负债。` : "所有数值字段均已填写，请核对单位与金额。"}</p>
      {notice && <p className="warning-box" role="status">{notice}</p>}
      <div className="modal-actions"><button className="button secondary" type="button" disabled={saving} onClick={() => {
        setDraft(createProfileDraft({ ...profile, mode: "demo" }));
        setOptions(previous => ({ ...previous, useGoldQuote: false, useFundNav: false })); setNotice("");
      }}>清空本次输入</button><button className="button primary" type="submit" disabled={saving}><Check size={17} />{saving ? "正在保存…" : "保存并重新计算"}</button></div>
    </form>
  </Modal>;
}
