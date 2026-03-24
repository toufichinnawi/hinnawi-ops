import { useState, useCallback } from 'react';

/**
 * Trigger a browser download from a CSV string.
 */
function downloadCsv(csv: string, filename: string) {
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Hook that wraps a tRPC query-based export.
 * Returns { triggerExport, isExporting } where triggerExport calls the query and downloads.
 */
export function useCsvDownload() {
  const [isExporting, setIsExporting] = useState(false);

  const download = useCallback((csv: string, filename: string) => {
    downloadCsv(csv, filename);
  }, []);

  return { download, isExporting, setIsExporting };
}
