import Papa from 'papaparse';

const normalize = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const pennies = value => Math.round(Number(value || 0) * 100);
const signedPennies = transaction => pennies(transaction.amount) * (transaction.direction === 'Out' ? -1 : 1);

function money(value) {
    if (value == null || String(value).trim() === '') return null;
    const parsed = Number(String(value).replace(/[\s,£$]/g, '').replace(/^\((.*)\)$/, '-$1'));
    return Number.isFinite(parsed) ? parsed : null;
}

function csvDate(value, time) {
    const raw = String(value || '').trim();
    const uk = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const iso = uk ? `${uk[3]}-${uk[2].padStart(2, '0')}-${uk[1].padStart(2, '0')}` : raw;
    const result = time ? `${iso}T${time}` : iso;
    const parsed = new Date(result);
    const calendarDate = new Date(`${iso.substring(0, 10)}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || (uk && calendarDate.toISOString().substring(0, 10) !== iso)) return null;
    return result;
}

function categoryFor({ type, name, reference, category, description, amount }) {
    const text = `${name} ${reference} ${description}`;
    if (/^pot transfer$/i.test(type)) return 'Internal Transfer';
    if (/\bDV[AB]-\d|dividend/i.test(text) || /^dividends$/i.test(category)) return 'Dividends';
    if (/HMRC.*VAT|VAT.*HMRC/i.test(text)) return amount < 0 ? 'VAT Payment' : 'VAT Refund';
    if (/\b(?:dla|dal)(?:\b|[-\d])|director'?s? loan/i.test(text)) return 'DLA Payment';
    if (/HMRC/i.test(text)) return 'Tax / HMRC';
    if (/monzo-to-monzo/i.test(type)) return 'Transfer - Review';
    return category || (amount > 0 ? 'Other Income' : 'Other Expenses');
}

export function parseBankCsv(csvText, bankAccountId, currency = 'GBP') {
    const parsed = Papa.parse(csvText.replace(/^\uFEFF/, ''), {
        header: true, skipEmptyLines: 'greedy', transformHeader: header => header.trim()
    });
    if (parsed.errors.length) throw new Error(`Invalid CSV: ${parsed.errors[0].message}`);
    if (!parsed.data.length) throw new Error('CSV has no transaction rows');
    const transactions = [];
    const rejected = [];
    parsed.data.forEach((raw, index) => {
        const row = Object.fromEntries(Object.entries(raw).map(([key, value]) => [normalize(key), value]));
        const pick = (...keys) => keys.map(key => row[normalize(key)]).find(value => value != null && String(value).trim() !== '') || '';
        const transactionDate = csvDate(pick('date', 'transaction date', 'booking date', 'posted date'), pick('time', 'transaction time'));
        const externalId = pick('transaction id', 'id');
        const name = pick('name', 'merchant', 'payee');
        const notes = pick('notes and #tags', 'notes', 'tags');
        const reference = pick('reference') || notes;
        const type = pick('type');
        const description = [...new Set([name, pick('description', 'details', 'narrative', 'memo'), notes, type].filter(Boolean))].join(' - ');
        let amount = money(pick('amount', 'transaction amount', 'value'));
        if (amount == null) {
            const credit = money(pick('credit', 'paid in', 'money in'));
            const debit = money(pick('debit', 'paid out', 'money out'));
            amount = credit != null && credit !== 0 ? Math.abs(credit) : debit != null ? -Math.abs(debit) : credit;
        }
        const rowCurrency = pick('currency');
        const balanceCurrency = pick('balance currency');
        const reason = !transactionDate ? 'Invalid date' : amount == null ? 'Invalid amount' : !description ? 'Missing description'
            : rowCurrency && rowCurrency !== currency ? `Currency ${rowCurrency} does not match ${currency}`
                : balanceCurrency && balanceCurrency !== currency ? `Balance currency ${balanceCurrency} does not match ${currency}` : null;
        if (reason) {
            rejected.push({ row: index + 2, reason });
            return;
        }
        transactions.push({
            bankAccountId, transactionDate, amount: Math.abs(amount), description,
            reference: reference || null, externalId: externalId || null,
            category: categoryFor({ type, name, reference, category: pick('category'), description, amount }),
            direction: amount < 0 ? 'Out' : 'In', balance: money(pick('balance', 'running balance')),
            source: 'CSV', monzoTransactionId: /^mm_/.test(externalId) ? externalId : null,
            monzoMerchantName: name || null, monzoNotes: notes || null
        });
    });
    return { transactions, rejected };
}

function transactionIds(transaction) {
    return [transaction.externalId, transaction.monzoTransactionId, transaction.trueLayerTransactionId].filter(Boolean);
}

function fingerprint(transaction) {
    return JSON.stringify([transaction.bankAccountId, transaction.transactionDate?.substring(0, 19),
        signedPennies(transaction), normalize(transaction.reference), normalize(transaction.description)]);
}

export function previewBankImport(transactions, existing = []) {
    const ids = new Set(existing.flatMap(transaction => transactionIds(transaction).map(id => `${transaction.bankAccountId}:${id}`)));
    const fingerprints = new Set(existing.map(fingerprint));
    const unidentifiedFingerprints = new Set(existing.filter(transaction => transactionIds(transaction).length === 0).map(fingerprint));
    const newTransactions = [];
    const duplicates = [];
    for (const transaction of transactions) {
        const keys = transactionIds(transaction).map(id => `${transaction.bankAccountId}:${id}`);
        const key = fingerprint(transaction);
        const duplicate = keys.some(id => ids.has(id)) || (keys.length ? unidentifiedFingerprints.has(key) : fingerprints.has(key));
        (duplicate ? duplicates : newTransactions).push(transaction);
        keys.forEach(id => ids.add(id));
        fingerprints.add(key);
        if (!keys.length) unidentifiedFingerprints.add(key);
    }
    return { newTransactions, duplicates, statement: summarizeBankStatement(transactions) };
}

export function summarizeBankStatement(transactions) {
    const ordered = transactions.map((transaction, index) => ({ ...transaction, statementOrder: index }))
        .sort((left, right) => left.transactionDate.localeCompare(right.transactionDate) || left.statementOrder - right.statementOrder);
    const incoming = ordered.filter(transaction => transaction.direction === 'In').reduce((total, transaction) => total + pennies(transaction.amount), 0);
    const outgoing = ordered.filter(transaction => transaction.direction === 'Out').reduce((total, transaction) => total + pennies(transaction.amount), 0);
    const transfers = ordered.filter(transaction => transaction.category === 'Internal Transfer');
    const potMovement = transfers.reduce((total, transaction) => total + signedPennies(transaction), 0);
    const first = ordered[0];
    const last = ordered.at(-1);
    const opening = first?.balance != null ? pennies(first.balance) - signedPennies(first) : null;
    const closing = last?.balance != null ? pennies(last.balance) : null;
    const calculatedClosing = opening != null ? opening + incoming - outgoing : null;
    let running = opening;
    const balanceErrors = [];
    if (running != null) {
        ordered.forEach(transaction => {
            running += signedPennies(transaction);
            if (transaction.balance != null && running !== pennies(transaction.balance)) {
                balanceErrors.push({ externalId: transaction.externalId, date: transaction.transactionDate, difference: (pennies(transaction.balance) - running) / 100 });
            }
        });
    }
    return {
        count: ordered.length, incoming: incoming / 100, outgoing: outgoing / 100, net: (incoming - outgoing) / 100,
        opening: opening == null ? null : opening / 100, closing: closing == null ? null : closing / 100,
        calculatedClosing: calculatedClosing == null ? null : calculatedClosing / 100,
        balanceErrors, internalTransferCount: transfers.length, potMovement: potMovement / 100,
        externalNet: (incoming - outgoing - potMovement) / 100, firstDate: first?.transactionDate, lastDate: last?.transactionDate
    };
}