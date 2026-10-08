import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const endpoint = read('Functions/VatSettlementFunctions.cs');
const vat = read('Functions/VatReturnFunctions.cs');

test('VAT settlement uses existing delegated owner auth before body or database', () => {
    assert.match(endpoint, /"post", Route = "vat-returns\/\{id:int\}\/settlement"/);
    const auth = endpoint.indexOf('await _auth.ValidateRequest(req)');
    assert.ok(auth >= 0 && auth < endpoint.indexOf('req.ReadAsStringAsync()'));
    assert.ok(auth < endpoint.indexOf('_db.Database.CreateExecutionStrategy()'));
    assert.match(endpoint, /!authorization.IsAuthorized.*Error\(authorization.StatusCode, authorization.Error/);
    assert.match(read('Services/SettlementAuthService.cs'), /"Settlement.Write"/);
    assert.match(endpoint, /WriteAsJsonAsync\(new \{ error = message \}, status\)/);
});

test('settlement is serializable and creates a single ledger plus optional bank match atomically', () => {
    assert.match(endpoint, /CreateExecutionStrategy\(\).ExecuteAsync/);
    assert.match(endpoint, /BeginTransactionAsync\(IsolationLevel.Serializable\)/);
    assert.equal((endpoint.match(/_db.CompanyLedger.Add\(/g) || []).length, 1);
    assert.equal((endpoint.match(/_db.ReconciliationMatches.Add\(/g) || []).length, 1);
    assert.match(endpoint, /RelatedType = "CompanyLedger"/);
    assert.match(endpoint, /RelatedId = entry.Id.ToString/);
    assert.match(endpoint, /bank.IsReconciled = true/);
    assert.ok(endpoint.indexOf('transaction.CommitAsync()') > endpoint.indexOf('bank.IsReconciled = true'));
    assert.doesNotMatch(endpoint, /record\.\w+\s*=(?!=)|_db.VatReturns.(Remove|Update|Add)\(/);
});

test('retry conflicts are decided before delta validation and never create another ledger', () => {
    assert.ok(endpoint.indexOf('VatSettlementPolicy.Identical') < endpoint.indexOf('VatSettlementPolicy.Validate(record'));
    assert.match(endpoint, /linked.Count > 0/);
    const retry = endpoint.indexOf('if (existing != null)');
    assert.ok(retry > 0 && retry < endpoint.indexOf('_db.CompanyLedger.Add('));
    assert.match(endpoint.slice(retry), /return retry;/);
});

test('strict payload accepts no duplicate fields and only ISO dates', () => {
    assert.match(endpoint, /"amount", "settlementDate", "bankTransactionId", "reference", "differenceReason"/);
    assert.match(endpoint, /Distinct\(StringComparer.OrdinalIgnoreCase\)/);
    assert.match(endpoint, /TryParseExact\(date.GetString\(\), "yyyy-MM-dd"/);
    assert.match(endpoint, /Notes\(id, request\).Length > 2000/);
});

test('bank ownership checks include every reconciliation link, ledger marker, expense and DLA', () => {
    assert.match(endpoint, /ReconciliationMatches.Where\(match => match.BankTransactionId == bankId\)/);
    assert.match(endpoint, /match.RelatedType != "CompanyLedger"/);
    assert.match(endpoint, /match.RelatedId != existing.Id.ToString/);
    assert.match(endpoint, /bank!.IsReconciled && existing == null/);
    assert.match(endpoint, /_db.Expenses.AnyAsync/);
    assert.match(endpoint, /_db.DlaEntries.AnyAsync/);
    assert.match(endpoint, /entry.Id != existingId/);
    assert.match(endpoint, /entry.Notes.Contains\(bankMarker\)/);
});

test('any existing same-date VAT cash is review-only, never automatically deleted or adopted across returns', () => {
    assert.match(endpoint, /entry.EntryType == "VAT_Paid" \|\| entry.EntryType == "VAT_Reclaim"/);
    assert.match(endpoint, /entry.Amount == request.Amount && entry.EffectiveDate >= start && entry.EffectiveDate < end/);
    assert.match(endpoint, /if \(legacy.Count > 0\)/);
    assert.doesNotMatch(endpoint, /Remove\(|DeleteAsync/);
});

test('GET performs one batched ledger projection without extra columns', () => {
    const get = vat.slice(vat.indexOf('[Function("GetVatReturns")]'), vat.indexOf('[Function("CreateVatReturn")]'));
    assert.equal((get.match(/ToListAsync\(\)/g) || []).length, 1);
    assert.match(get, /ToLookup/);
    assert.match(get, /VatSettlementPolicy.Project/);
    const model = read('Models/VatReturn.cs');
    assert.doesNotMatch(model, /SettlementAmount|SettlementDate|SettlementBankTransactionId|SettlementLedgerEntryId/);
    const create = vat.slice(vat.indexOf('[Function("CreateVatReturn")]'), vat.indexOf('[Function("UpdateVatReturn")]'));
    assert.match(create, /ReadFromJsonAsync<VatReturn>/);
    assert.doesNotMatch(create, /CompanyLedger.Add|ReconciliationMatches.Add/);
});

test('settled VAT updates and deletion serialize marker guards with writes', () => {
    const mutations = vat.slice(vat.indexOf('[Function("UpdateVatReturn")]'), vat.indexOf('[Function("UploadVatConfirmation")]'));
    assert.equal((mutations.match(/BeginTransactionAsync\(IsolationLevel.Serializable\)/g) || []).length, 2);
    assert.match(mutations, /ChangesFiledFigures/);
    assert.match(mutations, /ForeignCurrencyHelper.PreserveOmitted\(updated!, existing, body!\)/);
    assert.equal((mutations.match(/entry.Notes.Contains\(marker\)/g) || []).length, 2);
    assert.match(mutations, /HttpStatusCode.Conflict/);
    assert.match(mutations, /existing.Reference = updated.Reference/);
    assert.match(mutations, /existing.Notes = updated.Notes/);
    assert.match(mutations, /existing.ConfirmationPdfUrl = updated.ConfirmationPdfUrl/);
});

test('linked VAT ledger cannot be forged or deleted through generic ledger endpoint', () => {
    const ledger = read('Functions/CompanyLedgerFunctions.cs');
    assert.ok(ledger.indexOf('HasVatMarker(entry.Notes)') < ledger.indexOf('_companyLedgerRepository.CreateAsync(entry)'));
    assert.ok(ledger.indexOf('HasVatMarker(entry?.Notes)') < ledger.indexOf('_companyLedgerRepository.DeleteAsync(id)'));
    assert.match(ledger, /HttpStatusCode.Conflict/);
});

test('generic VAT create serializes same-type amount/date review guard with repository insert', () => {
    const ledger = read('Functions/CompanyLedgerFunctions.cs');
    const create = ledger.slice(ledger.indexOf('[Function("CreateCompanyLedgerEntry")]'), ledger.indexOf('[Function("DeleteCompanyLedgerEntry")]'));
    assert.match(ledger, /CompanyLedgerFunctions\([^\n]*FinanceHubDbContext db\)/);
    const vatStart = create.indexOf('if (entry.EntryType == "VAT_Paid" || entry.EntryType == "VAT_Reclaim")');
    const ordinary = create.indexOf('var createdEntry = await _companyLedgerRepository.CreateAsync(entry)');
    assert.ok(vatStart > create.indexOf('HasVatMarker(entry.Notes)') && ordinary > vatStart);
    const guarded = create.slice(vatStart, ordinary);
    assert.match(guarded, /return await _db.Database.CreateExecutionStrategy\(\).ExecuteAsync/);
    assert.match(guarded, /BeginTransactionAsync\(IsolationLevel.Serializable\)/);
    assert.match(guarded, /var start = entry.EffectiveDate.Date;\s*var end = start.AddDays\(1\)/);
    assert.match(guarded, /existing.EntryType == entry.EntryType\s*&& existing.Amount == entry.Amount && existing.EffectiveDate >= start && existing.EffectiveDate < end/);
    assert.ok(guarded.indexOf('AnyAsync') < guarded.indexOf('_companyLedgerRepository.CreateAsync(entry)'));
    assert.ok(guarded.indexOf('return conflict;') < guarded.indexOf('_companyLedgerRepository.CreateAsync(entry)'));
    assert.ok(guarded.indexOf('CommitAsync()') > guarded.indexOf('_companyLedgerRepository.CreateAsync(entry)'));
    assert.match(guarded, /WriteAsJsonAsync\(new \{ error:?.*review required.*\}, HttpStatusCode.Conflict\)/);
    assert.doesNotMatch(guarded, /Notes|HasVatMarker|Remove\(|DeleteAsync/);
    assert.match(guarded, /ChangeTracker.Clear\(\)/);
    assert.match(guarded, /entry.Id = originalId/);
});

test('expense GBP settlement checks VAT bank ownership before confirming expense', () => {
    const expense = read('Functions/GbpSettlementFunctions.cs');
    assert.ok(expense.indexOf('_db.ReconciliationMatches.Where') < expense.indexOf('expense.ActualGbpPaid ='));
    assert.match(expense, /match.RelatedType != "Expense"/);
    assert.match(expense, /bank!.IsReconciled && !isRetry/);
    assert.match(expense, /entry.Notes.Contains\(bankMarker\)/);
});

test('manual and auto reconciliation reject VAT banks before match creation', () => {
    const reconciliation = read('Functions/ReconciliationFunctions.cs');
    assert.equal((reconciliation.match(/await IsVatReservedAsync\(/g) || []).length, 2);
    assert.equal((reconciliation.match(/BeginTransactionAsync\(System.Data.IsolationLevel.Serializable\)/g) || []).length, 2);
    assert.match(reconciliation, /entry.Notes.Contains\(bankMarker\)/);
    assert.match(reconciliation, /entry.Id == ledgerId/);
    assert.match(reconciliation, /HttpStatusCode.Conflict/);
    assert.equal((reconciliation.match(/_db.ChangeTracker.Clear\(\)/g) || []).length, 2);
});