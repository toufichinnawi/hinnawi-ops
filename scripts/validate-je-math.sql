-- ============================================================
-- Revenue JE Validation: Find entries where debits != credits
-- ============================================================
-- 
-- The pipeline posts:
--   DEBIT:  AR amount + Petty Cash
--   CREDIT: taxExemptSales + taxableSales (with GST/QST tax code auto-calc) + Tips
--
-- QBO auto-calculates tax on the taxableSales line:
--   QBO_GST = ROUND(taxableSales * 0.05, 2)
--   QBO_QST = ROUND(taxableSales * 0.09975, 2)
--
-- The AR formula uses POS-recorded GST/QST which may differ from QBO's calculation.
-- This query finds ALL such discrepancies.

SELECT 
  ds.id,
  ds.locationId,
  CASE ds.locationId 
    WHEN 1 THEN 'PK'
    WHEN 2 THEN 'MK' 
    WHEN 3 THEN 'ONT'
    WHEN 4 THEN 'CT'
  END AS location,
  ds.saleDate,
  ds.totalSales,
  ds.taxExemptSales,
  ds.taxableSales,
  ds.gstCollected AS pos_gst,
  ds.qstCollected AS pos_qst,
  ROUND(ds.taxableSales * 0.05, 2) AS qbo_gst,
  ROUND(ds.taxableSales * 0.09975, 2) AS qbo_qst,
  ds.tipsCollected,
  ds.pettyCash,
  
  -- What the pipeline calculates as AR (using POS GST/QST):
  ROUND(ds.taxExemptSales + ds.taxableSales + ds.gstCollected + ds.qstCollected + ds.tipsCollected - ds.pettyCash, 2) AS ar_amount,
  
  -- DEBIT side = AR + pettyCash
  ROUND(ds.taxExemptSales + ds.taxableSales + ds.gstCollected + ds.qstCollected + ds.tipsCollected - ds.pettyCash + ds.pettyCash, 2) AS debit_total,
  
  -- CREDIT side = taxExemptSales + taxableSales + QBO_GST + QBO_QST + tips
  ROUND(ds.taxExemptSales + ds.taxableSales + ROUND(ds.taxableSales * 0.05, 2) + ROUND(ds.taxableSales * 0.09975, 2) + ds.tipsCollected, 2) AS credit_total,
  
  -- DIFFERENCE (debit - credit)
  ROUND(
    (ds.taxExemptSales + ds.taxableSales + ds.gstCollected + ds.qstCollected + ds.tipsCollected)
    - (ds.taxExemptSales + ds.taxableSales + ROUND(ds.taxableSales * 0.05, 2) + ROUND(ds.taxableSales * 0.09975, 2) + ds.tipsCollected)
  , 2) AS difference,
  
  -- GST difference (POS vs QBO calc)
  ROUND(ds.gstCollected - ROUND(ds.taxableSales * 0.05, 2), 2) AS gst_diff,
  
  -- QST difference (POS vs QBO calc)  
  ROUND(ds.qstCollected - ROUND(ds.taxableSales * 0.09975, 2), 2) AS qst_diff

FROM dailySales ds
WHERE ds.saleDate >= '2025-09-01' 
  AND ds.saleDate <= CURDATE()
  AND ds.totalSales > 0
HAVING difference != 0
ORDER BY ABS(difference) DESC;

-- ============================================================
-- Summary: total count, biggest difference, total difference
-- ============================================================
SELECT 
  COUNT(*) AS entries_with_difference,
  MAX(ABS(ROUND(
    (ds.gstCollected + ds.qstCollected) 
    - (ROUND(ds.taxableSales * 0.05, 2) + ROUND(ds.taxableSales * 0.09975, 2))
  , 2))) AS biggest_difference,
  SUM(ROUND(
    (ds.gstCollected + ds.qstCollected) 
    - (ROUND(ds.taxableSales * 0.05, 2) + ROUND(ds.taxableSales * 0.09975, 2))
  , 2)) AS total_difference,
  COUNT(CASE WHEN ds.taxExemptSales = 0 AND ds.taxableSales = 0 AND ds.totalSales > 0 THEN 1 END) AS entries_with_no_tax_split,
  COUNT(CASE WHEN ds.totalSales = 0 THEN 1 END) AS zero_sales_entries
FROM dailySales ds
WHERE ds.saleDate >= '2025-09-01' 
  AND ds.saleDate <= CURDATE();

-- ============================================================
-- Ontario weekend check: entries on Sat/Sun
-- ============================================================
SELECT 
  ds.saleDate,
  DAYNAME(ds.saleDate) AS day_name,
  ds.totalSales,
  ds.taxExemptSales,
  ds.taxableSales
FROM dailySales ds
WHERE ds.locationId = 3
  AND ds.saleDate >= '2025-09-01'
  AND ds.saleDate <= CURDATE()
  AND DAYOFWEEK(ds.saleDate) IN (1, 7)  -- Sunday=1, Saturday=7
ORDER BY ds.saleDate;
