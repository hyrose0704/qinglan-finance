import { briefHoldingsImpact } from "@/lib/brief-holdings";
import type { Profile } from "@/lib/finance";
import type { MorningEdition } from "@/lib/morning-brief";

const quantityFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 10 });
const yuan = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", signDisplay: "exceptZero" });

interface Props {
  profile: Profile;
  edition: MorningEdition;
  privacy: boolean;
  loadingProfile: boolean;
  editProfile: () => void;
}

export function BriefHoldingsImpact({ profile, edition, privacy, loadingProfile, editProfile }: Props) {
  const heading = profile.mode === "demo" ? "按演示持仓估算" : "按当前持仓估算";
  if (privacy || loadingProfile) return <section className="brief-impact"><h3>持仓金额影响</h3>
    <p>{privacy ? "金额隐私已开启，持仓数量与测算结果已隐藏。" : "正在读取资金档案…"}</p></section>;

  const { rows, total, subtotal } = briefHoldingsImpact(profile, edition);
  return <section className="brief-impact" aria-label={heading}>
    <div className="brief-impact-title"><h3>{heading}</h3>
      <button type="button" className="text-button" onClick={editProfile}>{profile.mode === "demo" ? "录入我的持仓" : "核对持仓"}</button>
    </div>
    <p className="brief-impact-basis">用当前填写的克数和份额回看 {edition.reviewDate}，假设期间持仓不变。实际买卖、平台点差、分红和份额折算需结合账户流水核对。</p>
    <dl className="brief-impact-lines">
      {rows.map(row => <div key={row.id}><dt>{row.name}</dt><dd>
        <span className="brief-impact-equation">{row.state === "estimated" && row.unitChange !== null && row.quantity !== null
          ? `${quantityFormat.format(row.quantity)} ${row.unit} × (${row.unitChange >= 0 ? "+" : "−"}${Math.abs(row.unitChange).toFixed(row.id === "fund" ? 4 : 2)} 元/${row.unit})`
          : row.quantity === null ? "持仓数量待填写" : `${quantityFormat.format(row.quantity)} ${row.unit}`}</span>
        <strong>{row.amount === null ? row.state === "missing-quantity" ? "待录入" : "待补行情" : yuan.format(row.amount)}</strong>
        <small>{row.state === "estimated" && row.previousDate ? `比较 ${row.previousDate} 与 ${edition.reviewDate}。` : ""}{row.note}</small>
      </dd></div>)}
    </dl>
    <div className="brief-impact-total"><span>{total !== null ? "黄金与基金合计变动" : subtotal !== null ? "可估算项小计" : "黄金与基金合计变动"}</span>
      <strong>{total !== null ? yuan.format(total) : subtotal !== null ? yuan.format(subtotal) : "待数据齐备"}</strong>
    </div>
    {subtotal !== null && <p className="brief-partial-note">小计只含已有可比价格且已填数量的持仓，另一项尚未计入。</p>}
    {rows.some(row => row.id === "fund" && row.state === "estimated") && edition.movements.find(move => move.id === "fund")?.supplementedAt &&
      <p className="brief-partial-note">基金金额采用本期发布后补录的净值计算。</p>}
  </section>;
}
