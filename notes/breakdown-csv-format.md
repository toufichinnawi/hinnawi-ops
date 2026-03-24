# Koomi Breakdown Sales CSV Format

## Header
- Line 1: Store name (e.g., "Hinnawi Bros (Mackay)")
- Line 2: Date range (e.g., "2025-01-01 00:00:00 to 2025-01-31 23:59:59")
- Line 3: Empty

## ITEMS Section (Line 4+)
Columns: ITEMS, CATEGORY, GROUP, TOTALS, QUANTITY SOLD, QUANTITY REFUNDED

Categories include: Café, Promotion, Dejeuners, Viennoiseries, Fresh bagels, Sandwichs, Sandwichs Végétarien, Boissons

Key fields:
- ITEMS: Product name
- CATEGORY: Product category
- GROUP: Always "All" for items
- TOTALS: Revenue in dollars (may have commas for thousands, e.g., "1,691.59")
- QUANTITY SOLD: Integer
- QUANTITY REFUNDED: Integer

## OPTIONS Section (after empty line + "OPTIONS,GROUP,,," header)
Columns: OPTIONS, GROUP, (empty), (empty), (empty)
These are modifiers/add-ons/sizes - separate from main items.

## Key Design Decisions
- Store the ITEMS section as product sales data
- OPTIONS section is modifier data (sizes, add-ons, bagel types)
- Both should be stored for complete analysis
- Date range comes from the filename and header line 2
- Store name comes from header line 1
