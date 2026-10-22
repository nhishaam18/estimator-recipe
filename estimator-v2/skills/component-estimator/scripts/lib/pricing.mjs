// Local planning helpers. Kajoo model billing is observed in platform traces.
export const CARD_FEE = 0.055;
export function estimateCost(e) {
    const fee = e.cardFee ? 1 + CARD_FEE : 1;
    const inputCost = ((e.calls * e.inputTokensPerCall) / 1e6) * e.priceIn * fee;
    const outputCost = ((e.calls * e.outputTokensPerCall) / 1e6) * e.priceOut * fee;
    const imageCost = e.calls * (e.imagePrice ?? 0) * fee;
    const total = inputCost + outputCost + imageCost;
    return { inputCost, outputCost, imageCost, total, perCall: e.calls ? total / e.calls : 0 };
}
export function money(x) {
    if (x === null || x === undefined || !Number.isFinite(x)) return 'unknown';
    if (x >= 100)
        return `$${x.toFixed(0)}`;
    if (x >= 1)
        return `$${x.toFixed(2)}`;
    if (x >= 0.01)
        return `$${x.toFixed(3)}`;
    return `$${x.toFixed(4)}`;
}
/** Number of tiles a page of this height needs. */
export function tileCount(pageHeight, tileHeight, overlap) {
    if (pageHeight <= tileHeight)
        return 1;
    const step = Math.max(1, tileHeight - overlap);
    return 1 + Math.ceil((pageHeight - tileHeight) / step);
}
