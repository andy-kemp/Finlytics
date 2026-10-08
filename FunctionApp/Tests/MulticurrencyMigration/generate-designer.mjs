import { readFileSync, writeFileSync } from 'node:fs';

const snapshot = new URL('../../Migrations/FinanceHubDbContextModelSnapshot.cs', import.meta.url);
const target = new URL('../../Migrations/20261008120000_AddMulticurrencyMetadata.Designer.cs', import.meta.url);
const source = readFileSync(snapshot, 'utf8');
const designer = source
    .replace('    [DbContext(typeof(FinanceHubDbContext))]\n', '')
    .replace('partial class FinanceHubDbContextModelSnapshot : ModelSnapshot', 'partial class AddMulticurrencyMetadata')
    .replace('protected override void BuildModel(ModelBuilder modelBuilder)', 'protected override void BuildTargetModel(ModelBuilder modelBuilder)');
if (designer === source || !designer.includes('BuildTargetModel(') || designer.includes(': ModelSnapshot')) {
    throw new Error('Snapshot format changed; designer generation requires review.');
}
if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== designer) throw new Error('Designer does not match the current snapshot.');
    console.log('Designer matches the complete snapshot.');
} else {
    writeFileSync(target, designer);
    console.log('Generated complete multicurrency target model from snapshot.');
}