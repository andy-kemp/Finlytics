// s455 tax on loans to participators (CTA 2010 s455), charged on each director's net overdrawn balance.
// Rate follows the dividend upper rate: 33.75% for loans made before 6 April 2026, 35.75% from then on.
export const S455_RATE_CHANGE_DATE = new Date(2026, 3, 6);

export function s455RateFor(loanDate) {
    return new Date(loanDate) >= S455_RATE_CHANGE_DATE ? 0.3575 : 0.3375;
}

/**
 * @param dlaEntries DLA entries with direction, director, entryDate and remainingBalance
 * @param asOf only entries dated on or before this date are considered (e.g. the period end)
 * @returns { base, charge, byDirector: [{ director, loans, credit, base, charge }] }
 *
 * Amounts the company owes a director offset that director's loans, oldest loans first,
 * so any later (higher-rate) loans remain chargeable.
 */
export function calculateS455(dlaEntries, asOf = null) {
    const cutoff = asOf ? new Date(asOf) : null;
    const byName = new Map();
    for (const entry of dlaEntries) {
        const balance = entry.remainingBalance ?? 0;
        if (balance <= 0 || (cutoff && new Date(entry.entryDate) > cutoff)) continue;
        const name = (entry.director || '').trim() || 'Director';
        const director = byName.get(name) || { director: name, loans: [], credit: 0 };
        if (entry.direction === 'OwedToCompany') director.loans.push({ date: new Date(entry.entryDate), balance });
        else if (entry.direction === 'OwedToDirector') director.credit += balance;
        byName.set(name, director);
    }

    const byDirector = [...byName.values()].map(({ director, loans, credit }) => {
        let remainingCredit = credit;
        let base = 0;
        let charge = 0;
        for (const loan of loans.sort((a, b) => a.date - b.date)) {
            const offset = Math.min(remainingCredit, loan.balance);
            remainingCredit -= offset;
            const chargeable = loan.balance - offset;
            base += chargeable;
            charge += chargeable * s455RateFor(loan.date);
        }
        return { director, loans: loans.reduce((sum, loan) => sum + loan.balance, 0), credit, base, charge };
    });

    return {
        base: byDirector.reduce((sum, row) => sum + row.base, 0),
        charge: byDirector.reduce((sum, row) => sum + row.charge, 0),
        byDirector
    };
}
