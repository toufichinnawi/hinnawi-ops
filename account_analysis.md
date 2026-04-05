# 9427-0659 Quebec Inc — QBO Account Analysis

## Account Naming Convention
- **PK** = Pointe-Claire location
- **MK** = Marché location (likely Marché de l'Ouest or similar)
- Accounts are suffixed with location tags (e.g., "5061 Beverage PK", "5060 Beverages MK")

## COGS / Cost of Goods Sold Accounts
| Account # | Account Name | Category | Subcategory |
|-----------|-------------|----------|-------------|
| 5061 | Beverage PK | COGS | null |
| 5205 | Purchase CK PK | COGS | null |
| 5208 | Disposable Material PK | COGS | null |
| 5210 | Purchase-General-PK (subtotal) | COGS | null |
| 5211 | Purchase-General MK (subtotal) | COGS | null |
| 5060 | Beverages MK | COGS | null |
| 5204 | Purchase CK MK | COGS | null |
| 5209 | Disposable Material MK | COGS | null |
| 5200 | Purchases (subtotal) | COGS | null |
| 5220 | Purchase Returns | COGS | null |
| 5240 | Early Payment Purchase Discounts | COGS | null |
| 5300 | Freight Expense | COGS | null |
| 5310 | Laundry & Linen | COGS | null |
| 5320 | Supplies, Cleaning & Paper | COGS | null |
| 5325 | Delivery | COGS | null |
| 5330 | Small Kitchen Equipment | COGS | null |
| 5469 | Coffee beans | COGS | null |
| - | Cost of Goods Sold | COGS | null |
| - | disposable material CK PK | COGS | null |
| - | Programme alimentation | COGS | null |

## Operating Expenses
| Account # | Account Name | Category | Subcategory |
|-----------|-------------|----------|-------------|
| 1563 | marketing Expenses | Operating Expenses | Marketing |
| 5125 | Advertisement commission - MK | Operating Expenses | Marketing |
| 5136 | Advertisement Commission - PK | Operating Expenses | Marketing |
| 5413 | wages & salary subsidiary | Operating Expenses | Payroll |
| 5414 | Tips & USalaries-PK | Operating Expenses | Payroll |
| 5606 | Royalties MK | Operating Expenses | Royalties |
| 5607 | Royalties - PK | Operating Expenses | Royalties |
| 5608 | Management fees PK | Operating Expenses | Management Fees |
| 5609 | Management Fees - MK | Operating Expenses | Management Fees |
| 5610 | Accounting & Legal - PK | Operating Expenses | Professional Fees |
| 5611 | Accounting & Legal - MK | Operating Expenses | Professional Fees |
| 5660 | Amortization Expense | Operating Expenses | Depreciation |
| 5690 | Interest & Bank Charges - MK | Operating Expenses | Interest |
| 5691 | Interest & Bank charges - PK | Operating Expenses | Interest |
| 5700 | Office Supplies - MK | Operating Expenses | Office / Admin |
| 5701 | Office Supplies - PK | Operating Expenses | Office / Admin |
| 5740 | Miscellaneous Expenses | Operating Expenses | Office / Admin |
| 5760 | Rent - PK | Operating Expenses | Rent / Occupancy |
| 5761 | Rent - MK | Operating Expenses | Rent / Occupancy |
| 5762 | rent | Operating Expenses | Rent / Occupancy |
| 5765 | Repair & Maintenance - MK | Operating Expenses | Repairs & Maintenance |
| 5766 | Repair & Maintenance - PK | Operating Expenses | Repairs & Maintenance |
| 5767 | Electricity & Heating - PK | Operating Expenses | Utilities |
| 5768 | Electricity & Heating - MK | Operating Expenses | Utilities |
| 5769 | Legal Fees & File | Operating Expenses | Professional Fees |
| 5780 | Telephone - MK | Operating Expenses | Utilities |
| 5781 | Telephone - PK | Operating Expenses | Utilities |
| 5783 | Computer Supplies &Security sys... | Operating Expenses | Office / Admin |
| 5785 | Computer Supplies &Security sys... | Operating Expenses | Office / Admin |
| 5798 | Car Expenses | Operating Expenses | Delivery / Vehicle |
| 5805 | Renovation 2021 | Operating Expenses | Repairs & Maintenance |
| - | Supplies mk | Operating Expenses | Office / Admin |

## Payroll Expenses
| Account # | Account Name | Category | Subcategory |
|-----------|-------------|----------|-------------|
| 5410 | Wages & Salaries-PK | Operating Expenses | Payroll |
| 5411 | Wages & salary-MK | Operating Expenses | Payroll |
| 5412 | Payroll gov deductions | Operating Expenses | Payroll |
| 5420 | EI Expense | Operating Expenses | Payroll |
| 5425 | QPP Expense | Operating Expenses | Payroll |
| 5440 | CSST Expense | Operating Expenses | Payroll |
| 5460 | QPP Expense | Operating Expenses | Payroll |
| 5465 | QPIP Expense | Operating Expenses | Payroll |
| 5466 | Vacation Expense Accrual | Operating Expenses | Payroll |
| 5467 | Stat Holiday Expense | Operating Expenses | Payroll |
| 5496 | Service Charges Payroll | Operating Expenses | Payroll |

## Keywords to Add to Classifier
- "beverage" → COGS
- "purchase" → COGS (already handled)
- "disposable" → COGS
- "freight" → COGS (currently goes to Delivery/Vehicle in OpEx)
- "laundry" / "linen" → COGS
- "cleaning" → COGS (when in COGS section)
- "kitchen equipment" → COGS
- "coffee" → COGS
- "programme alimentation" → COGS
- "advertisement" / "commission" → Marketing
- "royalt" → new subcategory or Office/Admin
- "management fee" → new subcategory or Professional Fees
- "tips" / "usalaries" → Payroll
- "subsidiary" → Payroll (when with wages/salary)
- "electricity" / "heating" → Utilities
- "computer" / "security" → Office/Admin
- "car expense" → Delivery/Vehicle
- "renovation" → Repairs & Maintenance
- "csst" → Payroll
- "qpp" → Payroll
- "stat holiday" → Payroll
- "service charges payroll" → Payroll
- "vacation expense" → Payroll
