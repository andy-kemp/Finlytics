// UK Corporation Tax from 1 April 2023: 19% up to £50k, 25% from £250k,
// marginal relief in between: CT = 25% × P − 3/200 × (£250,000 − P).
// Assumes a 12-month period with no associated companies or exempt distributions.
export const CT_LOWER_LIMIT = 50000;
export const CT_UPPER_LIMIT = 250000;
export const CT_SMALL_RATE = 0.19;
export const CT_MAIN_RATE = 0.25;
export const CT_STANDARD_FRACTION = 3 / 200;

// Adds calendar months, clamping to the last day of the target month (31 May + 9 months = 28/29 Feb).
// Returns local midday so toISOString() keeps the same calendar date under BST.
export function addMonthsClamped(date, months) {
    const source = new Date(date);
    const lastDay = new Date(source.getFullYear(), source.getMonth() + months + 1, 0).getDate();
    return new Date(source.getFullYear(), source.getMonth() + months, Math.min(source.getDate(), lastDay), 12);
}

// CT (and s455) payment is due 9 months and 1 day after the accounting period ends.
export function ctPaymentDeadline(periodEnd) {
    const date = addMonthsClamped(periodEnd, 9);
    date.setDate(date.getDate() + 1);
    return date;
}

// The CT600 return must be filed within 12 months of the accounting period end.
export function ct600FilingDeadline(periodEnd) {
    return addMonthsClamped(periodEnd, 12);
}

// Companies House accounts are due 9 months after the period end (later years; first accounts differ).
export function companiesHouseDeadline(periodEnd) {
    return addMonthsClamped(periodEnd, 9);
}

export function calculateCorporationTax(profit) {
    if (!(profit > 0)) return 0;
    if (profit <= CT_LOWER_LIMIT) return profit * CT_SMALL_RATE;
    if (profit >= CT_UPPER_LIMIT) return profit * CT_MAIN_RATE;
    return profit * CT_MAIN_RATE - CT_STANDARD_FRACTION * (CT_UPPER_LIMIT - profit);
}
