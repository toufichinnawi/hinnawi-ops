# Debug Notes: P&L showing $0.00

## Architecture
- FinancialStatements.tsx lists entities from `financialStatements.entities.list`
- Entity dropdown shows: location name + legal name
- PK and MK are separate entities but share the SAME realmId "9130346671806126" (9427-0659 Quebec Inc)
- ProfitAndLoss component receives `entityId` and calls `financialStatements.reports.profitAndLoss`
- That calls `financialReports.buildProfitAndLoss()` which:
  1. Fetches QBO P&L via `qboReports.fetchProfitAndLoss(entityId, startDate, endDate)`
  2. Gets line definitions via `financialDb.getFsLineDefinitions("profit_loss")`
  3. Calls `smartMap()` which checks for manual mappings first, then falls back to auto-classification
  4. Calls `buildLines()` to produce the final statement

## Key Issue: applyManualMappings
- `smartMap()` checks `getMappingsForEntity(entityId)` — if ANY mappings exist, it uses manual mode
- `applyManualMappings()` matches rows by `qboAccountId` (line 107)
- If a row's `accountId` doesn't match any mapping's `qboAccountId`, the row gets category="Uncategorized"
- This means: if only SOME accounts are mapped, the unmapped ones go to "Uncategorized" instead of being auto-classified

## Root Cause Hypothesis
The `smartMap()` function is all-or-nothing:
- If ANY manual mappings exist → ALL rows go through manual mapping
- Rows without a manual mapping → category="Uncategorized", subcategory=null
- This means most accounts show as Uncategorized and don't appear in any P&L line

## Fix Needed
Change `applyManualMappings()` to be a HYBRID approach:
- For rows that HAVE a manual mapping → use the manual mapping
- For rows that DON'T have a manual mapping → fall back to auto-classification
This way mapped accounts are respected AND unmapped accounts still get classified properly.
