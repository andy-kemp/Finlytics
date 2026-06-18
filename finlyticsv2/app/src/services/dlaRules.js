const DEFAULT_FY_START_MONTH = 4;
const DEFAULT_FY_START_DAY = 6;
const DEFAULT_S455_RATE = 0.3375;
const DEFAULT_BIK_THRESHOLD = 10000;

const toDate = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const addDays = (date, days) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
};

const addMonths = (date, months) => {
    const result = new Date(date);
    const day = result.getDate();
    result.setDate(1);
    result.setMonth(result.getMonth() + months);
    const maxDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(day, maxDay));
    return result;
};

const getAccountingYearEnd = (date, fyStartMonth, fyStartDay) => {
    if (!date) return null;
    const startMonth = Number(fyStartMonth) || DEFAULT_FY_START_MONTH;
    const startDay = Number(fyStartDay) || DEFAULT_FY_START_DAY;

    const year = date.getFullYear();
    const fyStartThisYear = new Date(year, startMonth - 1, startDay);

    if (date >= fyStartThisYear) {
        const fyStartNextYear = new Date(year + 1, startMonth - 1, startDay);
        return addDays(fyStartNextYear, -1);
    }

    return addDays(fyStartThisYear, -1);
};

const getS455DueDate = (yearEnd) => {
    if (!yearEnd) return null;
    return addDays(addMonths(yearEnd, 9), 1);
};

const getTaxYearEnd = (date) => {
    if (!date) return null;
    const year = date.getFullYear();
    const taxYearEndThisYear = new Date(year, 3, 5);
    if (date > taxYearEndThisYear) {
        return new Date(year + 1, 3, 5);
    }
    return taxYearEndThisYear;
};

const getOutstandingAtDueDate = (entry, dueDate) => {
    const datePaid = toDate(entry.datePaid);
    if (datePaid && dueDate && datePaid <= dueDate) {
        return 0;
    }
    if (datePaid && dueDate && datePaid > dueDate) {
        return Number(entry.amountGross) || 0;
    }

    if (entry.remainingBalance !== undefined && entry.remainingBalance !== null) {
        return Number(entry.remainingBalance) || 0;
    }

    return Number(entry.amountGross) || 0;
};

const getBikRisk = (entry, taxYearEnd, threshold) => {
    const amount = Number(entry.amountGross) || 0;
    if (amount <= threshold) return false;

    const datePaid = toDate(entry.datePaid);
    if (!taxYearEnd) return true;
    if (!datePaid) return true;
    return datePaid > taxYearEnd;
};

export const calculateDlaCompliance = (entries, companySettings, asOfDate = new Date()) => {
    const entryList = Array.isArray(entries) ? entries : [];
    const asOf = toDate(asOfDate) || new Date();

    const fyStartMonth = companySettings?.fyStartMonth;
    const fyStartDay = companySettings?.fyStartDay;

    const entryMap = {};
    let totalOutstanding = 0;
    let totalOwedToDirector = 0;
    let totalOwedToCompany = 0;
    let netOwedToDirector = 0;
    let s455DueTotal = 0;
    let s455PendingTotal = 0;
    let bikRiskCount = 0;

    entryList.forEach(entry => {
        const entryDate = toDate(entry.entryDate);
        const yearEnd = getAccountingYearEnd(entryDate, fyStartMonth, fyStartDay);
        const s455DueDate = getS455DueDate(yearEnd);
        const direction = entry.direction || entry.Direction || "OwedToDirector";
        const isOwedToCompany = String(direction).toLowerCase() === "owedtocompany";
        const outstandingAtDueDate = isOwedToCompany ? getOutstandingAtDueDate(entry, s455DueDate) : 0;

        const isS455DueNow = s455DueDate && asOf >= s455DueDate && outstandingAtDueDate > 0;
        const isS455Pending = s455DueDate && asOf < s455DueDate && outstandingAtDueDate > 0;

        const s455DueAmount = isS455DueNow ? outstandingAtDueDate * DEFAULT_S455_RATE : 0;
        const s455PendingAmount = isS455Pending ? outstandingAtDueDate * DEFAULT_S455_RATE : 0;

        const taxYearEnd = getTaxYearEnd(entryDate);
        const bikRisk = isOwedToCompany ? getBikRisk(entry, taxYearEnd, DEFAULT_BIK_THRESHOLD) : false;

        const remainingBalance = entry.remainingBalance !== undefined && entry.remainingBalance !== null
            ? Number(entry.remainingBalance) || 0
            : Number(entry.amountGross) || 0;

        totalOutstanding += remainingBalance;
        if (isOwedToCompany) {
            totalOwedToCompany += remainingBalance;
        } else {
            totalOwedToDirector += remainingBalance;
        }
        netOwedToDirector = totalOwedToDirector - totalOwedToCompany;
        s455DueTotal += s455DueAmount;
        s455PendingTotal += s455PendingAmount;
        if (bikRisk) bikRiskCount += 1;

        entryMap[entry.id] = {
            accountingYearEnd: yearEnd,
            s455DueDate,
            outstandingAtDueDate,
            s455DueAmount,
            s455PendingAmount,
            bikRisk
        };
    });

    return {
        totalOutstanding,
        totalOwedToDirector,
        totalOwedToCompany,
        netOwedToDirector,
        s455DueTotal,
        s455PendingTotal,
        bikRiskCount,
        entryMap
    };
};
