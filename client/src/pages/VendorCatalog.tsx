import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useQueryClient } from "@tanstack/react-query";

type TabId = "catalog" | "import" | "compare" | "orders";

export default function VendorCatalogPage() {
  const [activeTab, setActiveTab] = useState<TabId>("catalog");
  const [selectedSupplier, setSelectedSupplier] = useState<number | undefined>();
  const [csvContent, setCsvContent] = useState("");
  const [columnMapping, setColumnMapping] = useState({
    productName: "Product",
    price: "Price",
    sku: "SKU",
    unit: "Unit",
    packSize: "Pack Size",
    minQty: "",
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const suppliers = trpc.suppliers.list.useQuery();
  const catalog = trpc.vendorCatalog.bySupplier.useQuery(
    { supplierId: selectedSupplier || 0 },
    { enabled: !!selectedSupplier }
  );
  const priceComparisons = trpc.vendorCatalog.priceComparisons.useQuery(
    undefined,
    { enabled: activeTab === "compare" }
  );
  const pendingOrders = trpc.autoOrder.pendingOrders.useQuery(
    undefined,
    { enabled: activeTab === "orders" }
  );
  const orderHistory = trpc.autoOrder.history.useQuery(
    undefined,
    { enabled: activeTab === "orders" }
  );

  const importMutation = trpc.vendorCatalog.importCSV.useMutation({
    onSuccess: (data) => {
      queryClient.invalidateQueries();
      alert(`Imported: ${data.imported}, Updated: ${data.updated}${data.errors.length ? `, Errors: ${data.errors.length}` : ""}`);
    },
  });
  const autoLinkMutation = trpc.vendorCatalog.autoLink.useMutation({
    onSuccess: (data) => {
      queryClient.invalidateQueries();
      alert(`Auto-linked: ${data.linked}, Suggestions: ${data.suggestions.length}, Unlinked: ${data.unlinked}`);
    },
  });
  const sendPOMutation = trpc.autoOrder.sendPO.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        queryClient.invalidateQueries();
        alert("PO sent successfully!");
      } else {
        alert(`Failed: ${data.error}`);
      }
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCsvContent(ev.target?.result as string || "");
    };
    reader.readAsText(file);
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: "catalog", label: "Vendor Catalog" },
    { id: "import", label: "Import CSV" },
    { id: "compare", label: "Price Comparison" },
    { id: "orders", label: "Order Tracking" },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Vendor Catalog & Orders</h1>
          <p className="text-gray-500">Manage vendor products, compare prices, and track orders</p>
        </div>
        <select
          className="border rounded px-3 py-2"
          value={selectedSupplier || ""}
          onChange={(e) => setSelectedSupplier(e.target.value ? Number(e.target.value) : undefined)}
        >
          <option value="">Select Vendor</option>
          {suppliers.data?.map((s: any) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 font-medium rounded-t ${
              activeTab === tab.id
                ? "bg-white border border-b-white -mb-px text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* CATALOG TAB */}
      {activeTab === "catalog" && (
        <div>
          {!selectedSupplier ? (
            <div className="text-center py-12 text-gray-400">
              Select a vendor above to view their catalog
            </div>
          ) : (
            <>
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => autoLinkMutation.mutate({ supplierId: selectedSupplier })}
                  disabled={autoLinkMutation.isPending}
                  className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {autoLinkMutation.isPending ? "Linking..." : "Auto-Link to Inventory"}
                </button>
              </div>

              <div className="bg-white border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left">SKU</th>
                      <th className="px-3 py-2 text-left">Product Name</th>
                      <th className="px-3 py-2 text-left">Unit</th>
                      <th className="px-3 py-2 text-left">Pack Size</th>
                      <th className="px-3 py-2 text-right">Unit Price</th>
                      <th className="px-3 py-2 text-left">Linked Item</th>
                      <th className="px-3 py-2 text-left">Last Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalog.data?.map((item: any) => (
                      <tr key={item.id} className="border-t hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-500">{item.vendorSku || "—"}</td>
                        <td className="px-3 py-2 font-medium">{item.vendorProductName}</td>
                        <td className="px-3 py-2">{item.vendorUnit || "—"}</td>
                        <td className="px-3 py-2">{item.vendorPackSize || "—"}</td>
                        <td className="px-3 py-2 text-right">{item.unitPrice ? `$${Number(item.unitPrice).toFixed(2)}` : "—"}</td>
                        <td className="px-3 py-2">
                          {item.inventoryItemId ? (
                            <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">Linked</span>
                          ) : (
                            <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs">Unlinked</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-500">{item.lastPriceUpdate || "—"}</td>
                      </tr>
                    ))}
                    {(!catalog.data || catalog.data.length === 0) && (
                      <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">No catalog items. Import a CSV to get started.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Auto-link suggestions */}
              {autoLinkMutation.data?.suggestions && autoLinkMutation.data.suggestions.length > 0 && (
                <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <h3 className="font-semibold mb-2">Link Suggestions (review needed)</h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="text-left py-1">Vendor Product</th>
                        <th className="text-left py-1">Suggested Inventory Item</th>
                        <th className="text-right py-1">Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {autoLinkMutation.data.suggestions.map((s: any) => (
                        <tr key={s.catalogItemId} className="border-t">
                          <td className="py-1">{s.vendorProductName}</td>
                          <td className="py-1">{s.suggestedItemName}</td>
                          <td className="py-1 text-right">{s.confidence}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* IMPORT TAB */}
      {activeTab === "import" && (
        <div className="max-w-2xl">
          <div className="bg-white border rounded-lg p-6">
            <h3 className="font-semibold mb-4">Import Vendor Price List (CSV)</h3>

            {!selectedSupplier && (
              <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4 text-sm text-yellow-800">
                Select a vendor above before importing.
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">CSV File</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="border rounded px-3 py-2 w-full"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Column Mapping</label>
              <p className="text-xs text-gray-500 mb-2">Map your CSV column headers to the fields below:</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Product Name Column *</label>
                  <input className="border rounded px-2 py-1 w-full text-sm" value={columnMapping.productName}
                    onChange={(e) => setColumnMapping({ ...columnMapping, productName: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Price Column *</label>
                  <input className="border rounded px-2 py-1 w-full text-sm" value={columnMapping.price}
                    onChange={(e) => setColumnMapping({ ...columnMapping, price: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-gray-500">SKU Column</label>
                  <input className="border rounded px-2 py-1 w-full text-sm" value={columnMapping.sku}
                    onChange={(e) => setColumnMapping({ ...columnMapping, sku: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Unit Column</label>
                  <input className="border rounded px-2 py-1 w-full text-sm" value={columnMapping.unit}
                    onChange={(e) => setColumnMapping({ ...columnMapping, unit: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Pack Size Column</label>
                  <input className="border rounded px-2 py-1 w-full text-sm" value={columnMapping.packSize}
                    onChange={(e) => setColumnMapping({ ...columnMapping, packSize: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Min Order Qty Column</label>
                  <input className="border rounded px-2 py-1 w-full text-sm" value={columnMapping.minQty}
                    onChange={(e) => setColumnMapping({ ...columnMapping, minQty: e.target.value })} />
                </div>
              </div>
            </div>

            {csvContent && (
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">Preview (first 5 rows)</label>
                <pre className="bg-gray-50 rounded p-3 text-xs overflow-x-auto max-h-40">
                  {csvContent.split("\n").slice(0, 6).join("\n")}
                </pre>
              </div>
            )}

            <button
              onClick={() => {
                if (!selectedSupplier) return alert("Select a vendor first");
                if (!csvContent) return alert("Upload a CSV file first");
                importMutation.mutate({
                  supplierId: selectedSupplier,
                  csvContent,
                  columnMapping: {
                    productName: columnMapping.productName,
                    price: columnMapping.price,
                    sku: columnMapping.sku || undefined,
                    unit: columnMapping.unit || undefined,
                    packSize: columnMapping.packSize || undefined,
                    minQty: columnMapping.minQty || undefined,
                  },
                });
              }}
              disabled={!selectedSupplier || !csvContent || importMutation.isPending}
              className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {importMutation.isPending ? "Importing..." : "Import Catalog"}
            </button>
          </div>
        </div>
      )}

      {/* PRICE COMPARISON TAB */}
      {activeTab === "compare" && (
        <div>
          <div className="bg-white border rounded-lg p-4 mb-4">
            <h3 className="font-semibold mb-1">Price Comparison Across Vendors</h3>
            <p className="text-sm text-gray-500">Items available from multiple vendors, sorted by savings potential.</p>
          </div>

          {priceComparisons.data?.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              No items with multiple vendors found. Import catalogs and link items to see comparisons.
            </div>
          )}

          {priceComparisons.data?.map((comp: any) => (
            <div key={comp.inventoryItemId} className="bg-white border rounded-lg p-4 mb-3">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h4 className="font-semibold">{comp.itemName}</h4>
                  <span className="text-sm text-gray-500">{comp.unit}</span>
                </div>
                {comp.bestVendor && comp.bestVendor.savingsPct > 0 && (
                  <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-sm">
                    Save {comp.bestVendor.savingsPct.toFixed(0)}% with {comp.bestVendor.supplierName}
                  </span>
                )}
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-1.5 text-left">Vendor</th>
                    <th className="px-3 py-1.5 text-left">Product</th>
                    <th className="px-3 py-1.5 text-left">Pack</th>
                    <th className="px-3 py-1.5 text-right">Unit Price</th>
                    <th className="px-3 py-1.5 text-center">Best?</th>
                  </tr>
                </thead>
                <tbody>
                  {comp.vendors.map((v: any, i: number) => (
                    <tr key={i} className={`border-t ${v.isCheapest ? "bg-green-50" : ""}`}>
                      <td className="px-3 py-1.5">{v.supplierName}</td>
                      <td className="px-3 py-1.5">{v.vendorProductName}</td>
                      <td className="px-3 py-1.5">{v.packSize || "—"}</td>
                      <td className="px-3 py-1.5 text-right font-medium">${v.unitPrice.toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-center">
                        {v.isCheapest && <span className="text-green-600 font-bold">Best</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* ORDER TRACKING TAB */}
      {activeTab === "orders" && (
        <div>
          {/* Pending Orders */}
          <div className="bg-white border rounded-lg p-4 mb-4">
            <h3 className="font-semibold mb-3">Pending Orders</h3>
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">PO#</th>
                  <th className="px-3 py-2 text-left">Vendor</th>
                  <th className="px-3 py-2 text-left">Location</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Days</th>
                  <th className="px-3 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingOrders.data?.map((order: any) => (
                  <tr key={order.id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-sm">{order.poNumber}</td>
                    <td className="px-3 py-2">{order.supplierName}</td>
                    <td className="px-3 py-2">{order.locationName}</td>
                    <td className="px-3 py-2 text-right">${order.totalAmount.toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        order.status === "submitted" ? "bg-blue-100 text-blue-700" :
                        order.status === "approved" ? "bg-green-100 text-green-700" :
                        "bg-yellow-100 text-yellow-700"
                      }`}>
                        {order.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={order.daysSinceOrder > 3 ? "text-red-600 font-semibold" : ""}>
                        {order.daysSinceOrder}d
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {order.status === "approved" && (
                        <button
                          onClick={() => sendPOMutation.mutate({ purchaseOrderId: order.id })}
                          className="text-blue-600 hover:underline text-xs"
                        >
                          Send to Vendor
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {(!pendingOrders.data || pendingOrders.data.length === 0) && (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">No pending orders</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Order History */}
          <div className="bg-white border rounded-lg p-4">
            <h3 className="font-semibold mb-3">Order History</h3>
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">PO#</th>
                  <th className="px-3 py-2 text-left">Vendor</th>
                  <th className="px-3 py-2 text-left">Location</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Order Date</th>
                  <th className="px-3 py-2 text-left">Received</th>
                  <th className="px-3 py-2 text-right">Items</th>
                </tr>
              </thead>
              <tbody>
                {orderHistory.data?.map((order: any) => (
                  <tr key={order.id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-sm">{order.poNumber}</td>
                    <td className="px-3 py-2">{order.supplierName}</td>
                    <td className="px-3 py-2">{order.locationName}</td>
                    <td className="px-3 py-2 text-right">${order.totalAmount.toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        order.status === "received" ? "bg-green-100 text-green-700" :
                        order.status === "cancelled" ? "bg-red-100 text-red-700" :
                        "bg-gray-100 text-gray-700"
                      }`}>
                        {order.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">{order.orderDate}</td>
                    <td className="px-3 py-2">{order.receivedDate || "—"}</td>
                    <td className="px-3 py-2 text-right">{order.lineCount}</td>
                  </tr>
                ))}
                {(!orderHistory.data || orderHistory.data.length === 0) && (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">No order history</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
