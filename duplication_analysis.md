# Duplication Analysis

## Root Cause
PK Cafe (entity 1) and MK Cafe (entity 2) share the SAME QBO realm `9130346671806126`.
When the consolidated report calls `buildProfitAndLoss()` for each entity separately,
both entities get the FULL P&L from QBO (all accounts for both MK and PK).

The `buildProfitAndLoss()` function in `financialReports.ts` fetches the QBO report
for the entity's realm. Since both entities share realm `9130346671806126`, they both
get the same data. The MK/PK split is supposed to happen via department/class filtering,
but the report builder doesn't filter by department.

## Fix Options
1. **Deduplicate in consolidated report**: When multiple entities share the same realmId,
   only include the data ONCE (from the first entity), and split amounts by department/class.
2. **Filter by department in buildProfitAndLoss**: When building individual entity reports,
   filter the QBO data by the entity's department/class.

Option 2 is the correct fix — it ensures both single-entity AND consolidated views are correct.

## Entity-to-Department Mapping
- Entity 1 (PK Cafe) → Department: PK / Class: PK
- Entity 2 (MK Cafe) → Department: MK / Class: MK (or "Not specified" for shared)
