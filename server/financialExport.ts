/**
 * Financial Statement Export
 * Generates accountant-ready PDF, Excel, and CSV exports
 */
import type { FinancialStatement, StatementLine } from "./financialReports";

// ═══════════════════════════════════════════════════════════════════════════════
// CSV EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

function escapeField(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

export function statementToCsv(statement: FinancialStatement): string {
  const headers = ["Category", "Subcategory", "Label", "Current Period"];
  if (statement.lines.some(l => l.priorAmount !== null)) headers.push("Prior Period", "Variance ($)", "Variance (%)");
  if (statement.lines.some(l => l.priorYearAmount !== null)) headers.push("Prior Year", "YoY Variance ($)", "YoY Variance (%)");
  if (statement.reportMode === "qbo_plus_shared") headers.push("Shared Expenses", "Total w/ Shared");

  const rows = [headers.map(escapeField).join(",")];

  for (const line of statement.lines) {
    const row = [
      escapeField(line.category),
      escapeField(line.subcategory || ""),
      escapeField(line.label),
      line.currentAmount.toFixed(2),
    ];
    if (headers.includes("Prior Period")) {
      row.push(line.priorAmount?.toFixed(2) || "");
      row.push(line.varianceDollar?.toFixed(2) || "");
      row.push(line.variancePct?.toFixed(1) ? `${line.variancePct.toFixed(1)}%` : "");
    }
    if (headers.includes("Prior Year")) {
      row.push(line.priorYearAmount?.toFixed(2) || "");
      row.push(line.varianceYoyDollar?.toFixed(2) || "");
      row.push(line.varianceYoyPct?.toFixed(1) ? `${line.varianceYoyPct.toFixed(1)}%` : "");
    }
    if (headers.includes("Shared Expenses")) {
      row.push(line.sharedExpenseAmount.toFixed(2));
      row.push(line.totalWithShared.toFixed(2));
    }
    rows.push(row.join(","));
  }

  return rows.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTML-BASED PDF EXPORT (rendered server-side)
// ═══════════════════════════════════════════════════════════════════════════════

function formatCurrency(amount: number): string {
  const formatted = Math.abs(amount).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 ? `(${formatted})` : formatted;
}

function formatPct(pct: number | null): string {
  if (pct === null) return "";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

export function statementToHtml(statement: FinancialStatement): string {
  const title = statement.statementType === "profit_loss"
    ? "Profit & Loss Statement"
    : "Balance Sheet";

  const hasPrior = statement.lines.some(l => l.priorAmount !== null);
  const hasPriorYear = statement.lines.some(l => l.priorYearAmount !== null);
  const hasShared = statement.reportMode === "qbo_plus_shared";

  let colCount = 2; // Label + Current
  if (hasPrior) colCount += 3;
  if (hasPriorYear) colCount += 3;
  if (hasShared) colCount += 2;

  const headerCells = [`<th class="label">Account</th>`, `<th class="amount">Current Period</th>`];
  if (hasPrior) {
    headerCells.push(`<th class="amount">Prior Period</th>`);
    headerCells.push(`<th class="amount">Var ($)</th>`);
    headerCells.push(`<th class="amount">Var (%)</th>`);
  }
  if (hasPriorYear) {
    headerCells.push(`<th class="amount">Prior Year</th>`);
    headerCells.push(`<th class="amount">YoY ($)</th>`);
    headerCells.push(`<th class="amount">YoY (%)</th>`);
  }
  if (hasShared) {
    headerCells.push(`<th class="amount">Shared Exp.</th>`);
    headerCells.push(`<th class="amount">Total</th>`);
  }

  const bodyRows = statement.lines.map(line => {
    const isTotal = line.lineType === "total" || line.lineType === "subtotal";
    const isHeader = line.lineType === "header";
    const cls = isTotal ? "total-row" : isHeader ? "header-row" : "detail-row";
    const indent = line.subcategory && line.lineType === "detail" ? "padding-left: 24px;" : "";

    const cells = [
      `<td class="label" style="${indent}${isTotal ? "font-weight:700;" : ""}">${line.label}</td>`,
      `<td class="amount" style="${isTotal ? "font-weight:700;border-top:1px solid #333;" : ""}">${formatCurrency(line.currentAmount)}</td>`,
    ];
    if (hasPrior) {
      cells.push(`<td class="amount">${line.priorAmount !== null ? formatCurrency(line.priorAmount) : ""}</td>`);
      cells.push(`<td class="amount ${(line.varianceDollar || 0) < 0 ? "negative" : ""}">${line.varianceDollar !== null ? formatCurrency(line.varianceDollar) : ""}</td>`);
      cells.push(`<td class="amount ${(line.variancePct || 0) < 0 ? "negative" : ""}">${formatPct(line.variancePct)}</td>`);
    }
    if (hasPriorYear) {
      cells.push(`<td class="amount">${line.priorYearAmount !== null ? formatCurrency(line.priorYearAmount) : ""}</td>`);
      cells.push(`<td class="amount ${(line.varianceYoyDollar || 0) < 0 ? "negative" : ""}">${line.varianceYoyDollar !== null ? formatCurrency(line.varianceYoyDollar) : ""}</td>`);
      cells.push(`<td class="amount ${(line.varianceYoyPct || 0) < 0 ? "negative" : ""}">${formatPct(line.varianceYoyPct)}</td>`);
    }
    if (hasShared) {
      cells.push(`<td class="amount">${line.sharedExpenseAmount ? formatCurrency(line.sharedExpenseAmount) : ""}</td>`);
      cells.push(`<td class="amount" style="${isTotal ? "font-weight:700;" : ""}">${formatCurrency(line.totalWithShared)}</td>`);
    }

    return `<tr class="${cls}">${cells.join("")}</tr>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { margin: 1in; size: letter; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10pt; color: #1a1a1a; margin: 0; padding: 20px; }
  .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #1a1a1a; padding-bottom: 15px; }
  .header h1 { font-size: 16pt; margin: 0 0 4px 0; letter-spacing: 0.5px; }
  .header h2 { font-size: 12pt; font-weight: 400; margin: 0 0 4px 0; color: #555; }
  .header .period { font-size: 10pt; color: #777; }
  .header .mode { font-size: 8pt; color: #999; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th { background: #f5f5f5; border-bottom: 2px solid #333; padding: 6px 8px; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.5px; }
  th.label { text-align: left; }
  th.amount { text-align: right; }
  td { padding: 4px 8px; border-bottom: 1px solid #eee; }
  td.label { text-align: left; }
  td.amount { text-align: right; font-variant-numeric: tabular-nums; }
  .total-row td { border-top: 1px solid #333; border-bottom: 2px solid #333; font-weight: 700; }
  .header-row td { font-weight: 600; background: #fafafa; padding-top: 12px; }
  .negative { color: #c0392b; }
  .footer { margin-top: 30px; font-size: 8pt; color: #999; text-align: center; border-top: 1px solid #ddd; padding-top: 10px; }
</style>
</head>
<body>
  <div class="header">
    <h1>${statement.entityName}</h1>
    <h2>${title}</h2>
    <div class="period">${statement.periodLabel}</div>
    ${hasShared ? '<div class="mode">Includes Shared Expense Allocations</div>' : ""}
  </div>
  <table>
    <thead><tr>${headerCells.join("")}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <div class="footer">
    Generated ${new Date(statement.generatedAt).toLocaleDateString("en-CA")} | ${statement.currency} | Hinnawi Ops OS
  </div>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXCEL-COMPATIBLE EXPORT (TSV with .xls extension trick, or proper XLSX)
// ═══════════════════════════════════════════════════════════════════════════════

export function statementToExcelXml(statement: FinancialStatement): string {
  // Generate Excel XML Spreadsheet format (opens natively in Excel)
  const title = statement.statementType === "profit_loss" ? "Profit & Loss" : "Balance Sheet";
  const hasPrior = statement.lines.some(l => l.priorAmount !== null);
  const hasPriorYear = statement.lines.some(l => l.priorYearAmount !== null);
  const hasShared = statement.reportMode === "qbo_plus_shared";

  const headerRow = ["Account", "Current Period"];
  if (hasPrior) headerRow.push("Prior Period", "Variance ($)", "Variance (%)");
  if (hasPriorYear) headerRow.push("Prior Year", "YoY ($)", "YoY (%)");
  if (hasShared) headerRow.push("Shared Expenses", "Total w/ Shared");

  function cell(val: string | number, type: "String" | "Number" = "String") {
    if (type === "Number" && typeof val === "number") {
      return `<Cell><Data ss:Type="Number">${val}</Data></Cell>`;
    }
    return `<Cell><Data ss:Type="String">${String(val).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Data></Cell>`;
  }

  const rows = statement.lines.map(line => {
    const cells = [cell(line.label), cell(line.currentAmount, "Number")];
    if (hasPrior) {
      cells.push(cell(line.priorAmount ?? "", line.priorAmount !== null ? "Number" : "String"));
      cells.push(cell(line.varianceDollar ?? "", line.varianceDollar !== null ? "Number" : "String"));
      cells.push(cell(line.variancePct !== null ? `${line.variancePct.toFixed(1)}%` : ""));
    }
    if (hasPriorYear) {
      cells.push(cell(line.priorYearAmount ?? "", line.priorYearAmount !== null ? "Number" : "String"));
      cells.push(cell(line.varianceYoyDollar ?? "", line.varianceYoyDollar !== null ? "Number" : "String"));
      cells.push(cell(line.varianceYoyPct !== null ? `${line.varianceYoyPct.toFixed(1)}%` : ""));
    }
    if (hasShared) {
      cells.push(cell(line.sharedExpenseAmount, "Number"));
      cells.push(cell(line.totalWithShared, "Number"));
    }
    return `<Row>${cells.join("")}</Row>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="${title}">
<Table>
<Row>${headerRow.map(h => cell(h)).join("")}</Row>
<Row><Cell><Data ss:Type="String">${statement.entityName}</Data></Cell></Row>
<Row><Cell><Data ss:Type="String">${statement.periodLabel}</Data></Cell></Row>
<Row></Row>
${rows.join("\n")}
</Table>
</Worksheet>
</Workbook>`;
}
