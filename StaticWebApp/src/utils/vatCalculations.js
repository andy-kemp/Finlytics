export const VAT_ADJUSTMENTS_STORAGE_KEY = 'finlytics.vatQuarterAdjustments.v1';

export function isVatReclaimBlocked(item) {
    const category = (item.category || '').toLowerCase();
    return category.includes('entertainment')
        || category === 'trivial benefit'
        || item.isTrivialBenefit === true
        || item.ctTag === 'NonCT';
}

export function getVatQuarterPeriods(vatQuarterStartMonth = 1, numQuarters = 8) {
    const startM = (vatQuarterStartMonth - 1 + 12) % 12;
    const now = new Date();
    const monthsFromLastStart = (now.getMonth() - startM + 12) % 12;
    const monthsBack = monthsFromLastStart % 3;
    const currentQStart = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    return Array.from({ length: numQuarters }, (_, index) => {
        const qStart = new Date(currentQStart.getFullYear(), currentQStart.getMonth() - index * 3, 1);
        const qEnd = new Date(qStart.getFullYear(), qStart.getMonth() + 3, 0, 23, 59, 59, 999);
        let vatYearStart = new Date(qStart.getFullYear(), startM, 1);
        if (vatYearStart > qStart) vatYearStart.setFullYear(vatYearStart.getFullYear() - 1);

        const monthsIn = (qStart.getFullYear() - vatYearStart.getFullYear()) * 12
            + (qStart.getMonth() - vatYearStart.getMonth());
        const year = vatYearStart.getFullYear();

        return {
            quarterLabel: `Q${Math.floor(monthsIn / 3) + 1} ${year}/${String(year + 1).slice(-2)}`,
            monthsLabel: `${monthNames[qStart.getMonth()]} – ${monthNames[qEnd.getMonth()]} ${qEnd.getFullYear()}`,
            quarterStartDate: qStart.toISOString(),
            quarterEndDate: qEnd.toISOString(),
            isCurrent: index === 0
        };
    });
}

export function getFiledForQuarter(quarter, filedReturns) {
    const quarterStart = new Date(quarter.quarterStartDate);
    const matches = filedReturns.filter((record) =>
        Math.abs(new Date(record.quarterStartDate) - quarterStart) < 86400000
    );
    return matches.reduce((latest, record) =>
        !latest || new Date(record.filedDate) > new Date(latest.filedDate) ? record : latest
    , undefined);
}

export function getVatDisplayQuarters(quarters, settings, filedReturns) {
    const lowerBound = settings?.vatEffectiveDate
        ? new Date(settings.vatEffectiveDate)
        : settings?.companyInceptionDate
            ? new Date(settings.companyInceptionDate)
            : settings?.incorporationDate
                ? new Date(settings.incorporationDate)
                : null;

    if (!lowerBound) return quarters;
    return quarters.filter((quarter) =>
        new Date(quarter.quarterEndDate) >= lowerBound
        || new Date(quarter.quarterStartDate) >= lowerBound
        || !!getFiledForQuarter(quarter, filedReturns)
    );
}

export function calculateVatForQuarter(quarter, {
    invoices,
    expenses,
    dlaEntries,
    settings,
    displayQuarters,
    adjustment = {}
}) {
    const start = new Date(quarter.quarterStartDate);
    const end = new Date(quarter.quarterEndDate);
    const inceptionDate = settings?.incorporationDate
        ? new Date(settings.incorporationDate)
        : settings?.companyInceptionDate
            ? new Date(settings.companyInceptionDate)
            : null;
    const oldestQuarter = displayQuarters.reduce(
        (oldest, item) => item.quarterStartDate < oldest ? item.quarterStartDate : oldest,
        displayQuarters[0]?.quarterStartDate || ''
    );
    const isOldestDisplayedQuarter = !!oldestQuarter && quarter.quarterStartDate === oldestQuarter;
    const isFirstVatQuarter = inceptionDate
        ? (start <= inceptionDate && end >= inceptionDate) || isOldestDisplayedQuarter
        : isOldestDisplayedQuarter;
    const fourYearCutoff = inceptionDate
        ? new Date(inceptionDate.getFullYear() - 4, inceptionDate.getMonth(), inceptionDate.getDate())
        : null;
    const usePaymentDate = settings?.vatAccountingMethod !== 'invoice';

    const vatIn = invoices.reduce((sum, invoice) => {
        if (usePaymentDate) {
            if (!invoice.datePaid || invoice.status !== 'Paid') return sum;
            const date = new Date(invoice.datePaid);
            return date >= start && date <= end ? sum + (invoice.vatAmount || 0) : sum;
        }

        if (!invoice.dateIssued) return sum;
        const date = new Date(invoice.dateIssued);
        const isPreInception = inceptionDate && date < inceptionDate;
        if (!isPreInception && date >= start && date <= end) return sum + (invoice.vatAmount || 0);
        if (isPreInception && isFirstVatQuarter) return sum + (invoice.vatAmount || 0);
        if (isFirstVatQuarter && !isPreInception && inceptionDate && date >= inceptionDate && date < start)
            return sum + (invoice.vatAmount || 0);
        if (!inceptionDate && isOldestDisplayedQuarter && date < start) return sum + (invoice.vatAmount || 0);
        return sum;
    }, 0);

    const expenseApplies = (item) => {
        if (!item.entryDate) return false;
        const date = new Date(item.entryDate);
        const isPreInception = inceptionDate && date < inceptionDate;
        if (!isPreInception && date >= start && date <= end) return true;
        if (isPreInception && isFirstVatQuarter && (!fourYearCutoff || date >= fourYearCutoff)) return true;
        if (isFirstVatQuarter && !isPreInception && inceptionDate && date >= inceptionDate && date < start) return true;
        return !inceptionDate && isOldestDisplayedQuarter && date < start;
    };

    const vatOutExpenses = expenses
        .filter((expense) => !isVatReclaimBlocked(expense) && expenseApplies(expense))
        .reduce((sum, expense) => sum + (expense.vatAmount || 0), 0);
    const vatOutDla = dlaEntries
        .filter((entry) => entry.direction === 'OwedToDirector'
            && !isVatReclaimBlocked(entry) && expenseApplies(entry))
        .reduce((sum, entry) => sum + (entry.vatAmount || 0), 0);

    const vatExcludedItems = [
        ...expenses.filter((expense) => isVatReclaimBlocked(expense)
            && expense.vatAmount && expenseApplies(expense))
            .map((expense) => ({ ...expense, source: 'Expense' })),
        ...dlaEntries.filter((entry) => entry.direction === 'OwedToDirector'
            && isVatReclaimBlocked(entry) && entry.vatAmount && expenseApplies(entry))
            .map((entry) => ({ ...entry, source: 'DLA' }))
    ];
    const vatExcludedTotal = vatExcludedItems.reduce((sum, item) => sum + (item.vatAmount || 0), 0);
    const vatOutBase = vatOutExpenses + vatOutDla;
    const box1Adjustment = Number(adjustment.box1) || 0;
    const box4Adjustment = Number(adjustment.box4) || 0;
    const vatInAdjusted = vatIn + box1Adjustment;
    const vatOutAdjusted = vatOutBase + box4Adjustment;

    return {
        vatIn: vatInAdjusted,
        vatOut: vatOutAdjusted,
        vatInBase: vatIn,
        vatOutBase,
        adjustment: { ...adjustment, box1: box1Adjustment, box4: box4Adjustment },
        vatOutExpenses,
        vatOutDla,
        vatOwed: vatInAdjusted - vatOutAdjusted,
        isOldestDisplayedQuarter,
        vatExcludedItems,
        vatExcludedTotal
    };
}

export function getUnfiledVatBalance({ quarters, invoices, expenses, dlaEntries, filedReturns, settings, adjustments = {} }) {
    const displayQuarters = getVatDisplayQuarters(quarters, settings, filedReturns);
    return displayQuarters.reduce((sum, quarter) => {
        if (getFiledForQuarter(quarter, filedReturns)) return sum;
        const key = new Date(quarter.quarterStartDate).toISOString().slice(0, 10);
        const calculation = calculateVatForQuarter(quarter, {
            invoices,
            expenses,
            dlaEntries,
            settings,
            displayQuarters,
            adjustment: adjustments[key] || {}
        });
        return sum + calculation.vatOwed;
    }, 0);
}

export function getStoredVatAdjustments() {
    try {
        const raw = localStorage.getItem(VAT_ADJUSTMENTS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}