# Data Audit for CFO Intelligence Dashboard

## Daily Sales (4 locations, 1,610 total days)
| Location | Days | Date Range | Total Revenue | Orders | Labor Cost | GST | QST |
|----------|------|------------|---------------|--------|------------|-----|-----|
| PK (1) | 432 | Jan 2025 - Mar 2026 | $1,286,060 | 127,977 | $300,281 | $22,604 | $45,095 |
| MK (2) | 431 | Jan 2025 - Mar 2026 | $746,824 | 61,621 | $185,973 | $14,781 | $29,488 |
| ONT (3) | 438 | Jan 2025 - Mar 2026 | $251,229 | 20,057 | $4,438 | $160 | $318 |
| CT (4) | 309 | Jan 2025 - Mar 2026 | $287,563 | 29,999 | $103,205 | $4,068 | $8,115 |
| **TOTAL** | | | **$2,571,676** | **239,654** | **$593,897** | | |

## Product Sales (1 location so far)
| Location | Items | Rows | Date Range | Revenue |
|----------|-------|------|------------|---------|
| MK (2) | 64 | 67 | Jan 2025 | $36,071 |

## Payroll (5 locations, 25 records)
| Location | Records | Date Range | Gross Wages | Employer Contrib | Hours |
|----------|---------|------------|-------------|------------------|-------|
| PK (1) | 5 | Jan-Mar 2025 | $43,014 | $5,761 | 2,099 |
| MK (2) | 5 | Jan-Mar 2025 | $31,304 | $4,334 | 1,552 |
| ONT (3) | 5 | Dec 2024-Mar 2025 | $17,048 | $2,557 | 2,978 |
| CT (4) | 5 | Jan-Mar 2025 | $19,011 | $2,593 | 963 |
| FAC (5) | 5 | Jan-Mar 2025 | $36,229 | $5,252 | 1,775 |

## Recipes & Menu Items
- 25 recipes (24 with costs)
- 55 menu items (22 linked to recipes)
- Product names are in French (Koomi), menu items in English

## Location Targets
| Location | Labor Target | Food Cost Target |
|----------|-------------|-----------------|
| PK | 18% | 30% |
| MK | 23% | 30% |
| ONT | 28% | 31% |
| CT | 24% | 29% |
| FAC | 20% | 28% |

## Key Metrics Available for CFO Dashboard
1. Revenue per store (daily granularity, 14+ months)
2. Labor cost from dailySales (7shifts) + payroll records (ADP)
3. Tax collected (GST/QST) by store
4. Tips and merchant fees
5. Order count / average ticket size
6. Product-level sales (MK only so far)
7. Recipe costs for margin analysis
8. Labor targets vs actuals by store
