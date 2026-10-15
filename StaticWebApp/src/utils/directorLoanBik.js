// Beneficial loan benefit in kind (ITEPA 2003 s180): no charge if a director's total loans
// stay at or below £10,000 throughout the tax year. The test is on the running balance,
// not on individual entries, so several smaller loans can breach it together.
export const BIK_THRESHOLD = 10000;

const taxYearStart = (date) => {
    const start = new Date(date.getFullYear(), 3, 6);
    return date >= start ? start : new Date(date.getFullYear() - 1, 3, 6);
};

/**
 * Peak overdrawn balance per director per tax year.
 * Loans add their gross amount on entryDate and fall away on datePaid; amounts the company owes the
 * director reduce the balance while outstanding. Part-payments without dates are not modelled.
 * @returns Map keyed `${director}|${taxYearStartISODate}` → peak overdrawn balance in that tax year
 */
export function peakOverdrawnByTaxYear(dlaEntries) {
    const eventsByDirector = new Map();
    for (const entry of dlaEntries) {
        const amount = Number(entry.amountGross) || 0;
        const start = entry.entryDate ? new Date(entry.entryDate) : null;
        if (!amount || !start || Number.isNaN(start.getTime())) continue;
        const sign = String(entry.direction).toLowerCase() === 'owedtocompany' ? 1 : -1;
        const name = (entry.director || '').trim() || 'Director';
        const events = eventsByDirector.get(name) || [];
        events.push({ date: start, delta: sign * amount });
        if (entry.datePaid) events.push({ date: new Date(entry.datePaid), delta: -sign * amount });
        eventsByDirector.set(name, events);
    }

    const peaks = new Map();
    for (const [director, events] of eventsByDirector) {
        events.sort((a, b) => a.date - b.date || a.delta - b.delta);
        let balance = 0;
        for (const event of events) {
            balance += event.delta;
            const key = `${director}|${taxYearStart(event.date).toISOString().slice(0, 10)}`;
            peaks.set(key, Math.max(peaks.get(key) ?? 0, balance));
        }
    }
    return peaks;
}

export function bikRiskFor(entry, peaks, threshold = BIK_THRESHOLD) {
    if (String(entry.direction).toLowerCase() !== 'owedtocompany' || !entry.entryDate) return false;
    const director = (entry.director || '').trim() || 'Director';
    const key = `${director}|${taxYearStart(new Date(entry.entryDate)).toISOString().slice(0, 10)}`;
    return (peaks.get(key) ?? 0) > threshold;
}
