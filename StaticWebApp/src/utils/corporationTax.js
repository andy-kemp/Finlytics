// UK Corporation Tax from 1 April 2023: 19% up to £50k, 25% from £250k,
// marginal relief in between: CT = 25% × P − 3/200 × (£250,000 − P).
// Assumes a 12-month period with no associated companies or exempt distributions.
export const CT_LOWER_LIMIT = 50000;
export const CT_UPPER_LIMIT = 250000;
export const CT_SMALL_RATE = 0.19;
export const CT_MAIN_RATE = 0.25;
export const CT_STANDARD_FRACTION = 3 / 200;

export function calculateCorporationTax(profit) {
    if (!(profit > 0)) return 0;
    if (profit <= CT_LOWER_LIMIT) return profit * CT_SMALL_RATE;
    if (profit >= CT_UPPER_LIMIT) return profit * CT_MAIN_RATE;
    return profit * CT_MAIN_RATE - CT_STANDARD_FRACTION * (CT_UPPER_LIMIT - profit);
}
