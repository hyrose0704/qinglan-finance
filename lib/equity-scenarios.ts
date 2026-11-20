// Fictional teaching case. Revenue and diluted shares are both expressed in hundreds of millions.
export const EQUITY_CASE = {
  revenue: 20,
  dilutedShares: 1,
  referencePrice: 32,
  margin: { min: -5, max: 25, initial: 10, spread: 3 },
  multiple: { min: 8, max: 32, initial: 16, spread: 4 },
} as const;

function equityCase(margin: number, multiple: number) {
  const eps = EQUITY_CASE.revenue * (margin / 100) / EQUITY_CASE.dilutedShares;
  const price = eps > 0 ? eps * multiple : null;
  const differencePct = price === null ? null : (price / EQUITY_CASE.referencePrice - 1) * 100;
  return { margin, multiple, eps, price, differencePct };
}

export function compareEquityScenarios(margin: number, multiple: number) {
  const settings = EQUITY_CASE;
  if (!Number.isFinite(margin) || margin < settings.margin.min || margin > settings.margin.max ||
      !Number.isFinite(multiple) || multiple < settings.multiple.min || multiple > settings.multiple.max) {
    throw new RangeError("基准净利率或市盈率超出本实验范围。");
  }

  const downside = equityCase(margin - settings.margin.spread, multiple - settings.multiple.spread);
  const base = equityCase(margin, multiple);
  const upside = equityCase(margin + settings.margin.spread, multiple + settings.multiple.spread);
  const requiredEps = settings.referencePrice / multiple;
  const requiredMargin = requiredEps * settings.dilutedShares / settings.revenue * 100;

  // Change margin first, then the multiple, so the interaction is counted exactly once.
  const earningsBridge = base.price !== null && upside.price !== null ? {
    marginEffect: (upside.eps - base.eps) * base.multiple,
    multipleEffect: upside.eps * (upside.multiple - base.multiple),
  } : null;

  return { downside, base, upside, requiredEps, requiredMargin, earningsBridge };
}
