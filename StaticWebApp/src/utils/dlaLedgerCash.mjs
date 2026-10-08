const normalizeId = value => String(value || '').trim().toUpperCase();

export function isRepresentedDlaLedgerEntry(entry, dlaEntries = []) {
    if (!String(entry.entryType || '').startsWith('DLA_')) return false;
    if (/^DLA Startup:/i.test(String(entry.title || '').trim())) return true;
    const knownIds = new Set(dlaEntries.map(loan => normalizeId(loan.dlaId)).filter(Boolean));
    if (knownIds.has(normalizeId(entry.dlaReference))) return true;
    const legacyReference = String(entry.notes || '').match(/(?:DLA ID:\s*|Payment for DLA\s+)(DLA-[A-Z0-9-]+)/i);
    return Boolean(legacyReference && knownIds.has(normalizeId(legacyReference[1])));
}