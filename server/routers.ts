import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import * as qbo from "./qbo";
import * as autoRetry from "./autoRetry";
import * as sevenShifts from "./sevenShifts";
import * as koomi from "./koomiScraper";
import * as koomiScheduler from "./koomiScheduler";
import * as csvExport from "./csvExport";
import * as sevenShiftsScheduler from "./sevenShiftsScheduler";
import * as msgraph from "./msgraph";
import * as costPipeline from "./invoiceCostPipeline";
import * as financialDb from "./financialDb";
import * as financialReports from "./financialReports";
import * as financialExport from "./financialExport";
import * as qboReports from "./qboReports";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  locations: router({
    list: publicProcedure.query(async () => {
      return db.getAllLocations();
    }),
  }),

  dashboard: router({
    kpis: publicProcedure.input(z.object({ date: z.string() })).query(async ({ input }) => {
      const sales = await db.getDailySalesForDate(input.date);
      const invoiceCounts = await db.getInvoiceCount();
      const alerts = await db.getActiveAlerts();

      const totalSales = sales.reduce((sum, s) => sum + Number(s.totalSales), 0);
      const totalGst = sales.reduce((sum, s) => sum + Number(s.gstCollected), 0);
      const totalQst = sales.reduce((sum, s) => sum + Number(s.qstCollected), 0);

      return {
        totalSales,
        totalGst,
        totalQst,
        locationSales: sales,
        pendingInvoices: Number(invoiceCounts.pending),
        pendingInvoiceAmount: Number(invoiceCounts.pendingAmount),
        totalInvoices: Number(invoiceCounts.total),
        alertCount: alerts.length,
      };
    }),

    storePerformance: publicProcedure.input(z.object({
      startDate: z.string(),
      endDate: z.string(),
    })).query(async ({ input }) => {
      const [sales, payroll, locs] = await Promise.all([
        db.getSalesRange(input.startDate, input.endDate),
        db.getPayrollRange(input.startDate, input.endDate),
        db.getAllLocations(),
      ]);

      const locMap = new Map(locs.map(l => [l.id, l]));
      const perfMap = new Map<number, { revenue: number; laborCost: number; laborTarget: number; foodCostTarget: number; name: string; code: string }>();

      for (const loc of locs) {
        perfMap.set(loc.id, {
          revenue: 0,
          laborCost: 0,
          laborTarget: Number(loc.laborTarget),
          foodCostTarget: Number(loc.foodCostTarget),
          name: loc.name,
          code: loc.code,
        });
      }

      for (const s of sales) {
        const p = perfMap.get(s.locationId);
        if (p) p.revenue += Number(s.totalSales);
      }

      // Use actual labour cost from dailySales if available
      for (const s of sales) {
        const p = perfMap.get(s.locationId);
        if (p) p.laborCost += Number(s.labourCost || 0);
      }

      // Fall back to payroll data for locations without daily labour cost
      for (const pr of payroll) {
        const p = perfMap.get(pr.locationId);
        if (p && p.laborCost === 0) p.laborCost += Number(pr.grossWages) + Number(pr.employerContributions);
      }

      return Array.from(perfMap.entries()).map(([id, p]) => ({
        locationId: id,
        name: p.name,
        code: p.code,
        revenue: p.revenue,
        laborCost: p.laborCost,
        laborPct: p.revenue > 0 ? (p.laborCost / p.revenue) * 100 : 0,
        laborTarget: p.laborTarget,
        foodCostTarget: p.foodCostTarget,
        foodCostPct: p.foodCostTarget, // placeholder until real COGS data
      }));
    }),

    salesTrend: publicProcedure.input(z.object({
      startDate: z.string(),
      endDate: z.string(),
    })).query(async ({ input }) => {
      const sales = await db.getSalesRange(input.startDate, input.endDate);
      const locations = await db.getAllLocations();
      const locMap = new Map(locations.map(l => [l.id, l.code]));
      // Group by date with per-location breakdown
      const byDate = new Map<string, { total: number; byLoc: Record<string, number>; orders: number; labor: number }>();
      for (const s of sales) {
        const raw = s.saleDate;
        const d = raw instanceof Date ? raw.toISOString().split('T')[0] : String(raw).slice(0, 10);
        if (!byDate.has(d)) byDate.set(d, { total: 0, byLoc: {}, orders: 0, labor: 0 });
        const entry = byDate.get(d)!;
        const amt = Number(s.totalSales);
        const code = locMap.get(s.locationId) || 'UNK';
        entry.total += amt;
        entry.byLoc[code] = (entry.byLoc[code] || 0) + amt;
        entry.orders += (s.orderCount || 0);
        entry.labor += Number(s.labourCost || 0);
      }
      return Array.from(byDate.entries()).map(([date, data]) => ({
        date,
        total: data.total,
        orders: data.orders,
        labor: data.labor,
        ...data.byLoc,
      })).sort((a, b) => a.date.localeCompare(b.date));
    }),

    monthlySummary: publicProcedure.input(z.object({ year: z.number(), locationIds: z.array(z.number()).optional() })).query(async ({ input }) => {
      return db.getMonthlySalesSummary(input.year, input.locationIds);
    }),
  }),

  invoices: router({
    list: publicProcedure.input(z.object({ status: z.string().optional() }).optional()).query(async ({ input }) => {
      const invs = await db.getInvoices(input?.status);
      const suppliers = await db.getAllSuppliers();
      const locs = await db.getAllLocations();
      const supMap = new Map(suppliers.map(s => [s.id, s]));
      const locMap = new Map(locs.map(l => [l.id, l]));
      return invs.map(inv => ({
        ...inv,
        supplierName: supMap.get(inv.supplierId!)?.name || 'Unknown',
        locationName: locMap.get(inv.locationId!)?.name || 'Unknown',
      }));
    }),
    updateStatus: protectedProcedure.input(z.object({ id: z.number(), status: z.string() })).mutation(async ({ input }) => {
      await db.updateInvoiceStatus(input.id, input.status);
      // AUTO-TRIGGER: Run cost pipeline when invoice is approved
      if (input.status === 'approved') {
        costPipeline.runInvoiceCostPipeline(input.id).catch(err =>
          console.error('[CostPipeline] Background pipeline error:', err)
        );
      }
      return { success: true };
    }),
    updateLocation: protectedProcedure.input(z.object({
      id: z.number(),
      locationId: z.number(),
    })).mutation(async ({ input }) => {
      await db.updateInvoiceLocation(input.id, input.locationId);
      return { success: true };
    }),
    create: protectedProcedure.input(z.object({
      invoiceNumber: z.string().optional(),
      supplierId: z.number().optional(),
      locationId: z.number().optional(),
      invoiceDate: z.string().optional(),
      dueDate: z.string().optional(),
      subtotal: z.string().optional(),
      gst: z.string().optional(),
      qst: z.string().optional(),
      total: z.string().optional(),
      glAccount: z.string().optional(),
      notes: z.string().optional(),
    })).mutation(async ({ input }) => {
      const id = await db.createInvoice({
        ...input,
        status: 'pending',
      });
      return { success: true, id };
    }),
    get: publicProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const inv = await db.getInvoiceById(input.id);
      if (!inv) return null;
      const suppliers = await db.getAllSuppliers();
      const locs = await db.getAllLocations();
      const supplier = suppliers.find(s => s.id === inv.supplierId);
      const location = locs.find(l => l.id === inv.locationId);
      const lineItems = await db.getInvoiceLineItems(input.id);
      return { ...inv, supplierName: supplier?.name || 'Unknown', locationName: location?.name || 'Unknown', lineItems };
    }),
    uploadFile: protectedProcedure.input(z.object({
      invoiceId: z.number(),
      fileType: z.enum(['invoice', 'deliveryNote']),
      fileData: z.string(), // base64 encoded
      fileName: z.string(),
      contentType: z.string(),
    })).mutation(async ({ input }) => {
      const { storagePut } = await import('./storage');
      const buffer = Buffer.from(input.fileData, 'base64');
      const suffix = Math.random().toString(36).substring(2, 8);
      const key = `invoices/${input.invoiceId}/${input.fileType}-${suffix}-${input.fileName}`;
      const { url } = await storagePut(key, buffer, input.contentType);
      if (input.fileType === 'invoice') {
        await db.updateInvoiceFile(input.invoiceId, { fileUrl: url, fileKey: key });
      } else {
        await db.updateInvoiceFile(input.invoiceId, { deliveryNoteUrl: url, deliveryNoteKey: key });
      }
      // Auto-approval check: if both files are now present, auto-approve
      const inv = await db.getInvoiceById(input.invoiceId);
      if (inv && inv.status === 'pending') {
        const hasInvoice = input.fileType === 'invoice' ? true : !!inv.fileUrl;
        const hasDelivery = input.fileType === 'deliveryNote' ? true : !!inv.deliveryNoteUrl;
        if (hasInvoice && hasDelivery) {
          await db.updateInvoiceStatus(input.invoiceId, 'approved');
          await db.updateInvoiceAutoApproved(input.invoiceId, true);
          // AUTO-TRIGGER: Run cost pipeline on auto-approval
          costPipeline.runInvoiceCostPipeline(input.invoiceId).catch(err =>
            console.error('[CostPipeline] Background pipeline error:', err)
          );
        }
      }
      return { success: true, url, key };
    }),
    removeFile: protectedProcedure.input(z.object({
      invoiceId: z.number(),
      fileType: z.enum(['invoice', 'deliveryNote']),
    })).mutation(async ({ input }) => {
      if (input.fileType === 'invoice') {
        await db.updateInvoiceFile(input.invoiceId, { fileUrl: null, fileKey: null });
      } else {
        await db.updateInvoiceFile(input.invoiceId, { deliveryNoteUrl: null, deliveryNoteKey: null });
      }
      return { success: true };
    }),
  }),

  quotations: router({
    list: publicProcedure.input(z.object({ status: z.string().optional() }).optional()).query(async ({ input }) => {
      const quots = await db.getQuotations(input?.status);
      const suppliers = await db.getAllSuppliers();
      const locs = await db.getAllLocations();
      const supMap = new Map(suppliers.map(s => [s.id, s]));
      const locMap = new Map(locs.map(l => [l.id, l]));
      return quots.map(q => ({
        ...q,
        supplierName: supMap.get(q.supplierId!)?.name || 'Unknown',
        locationName: locMap.get(q.locationId!)?.name || 'Unknown',
      }));
    }),
    get: publicProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const q = await db.getQuotationById(input.id);
      if (!q) return null;
      const suppliers = await db.getAllSuppliers();
      const locs = await db.getAllLocations();
      const supplier = suppliers.find(s => s.id === q.supplierId);
      const location = locs.find(l => l.id === q.locationId);
      return { ...q, supplierName: supplier?.name || 'Unknown', locationName: location?.name || 'Unknown' };
    }),
    counts: publicProcedure.query(async () => {
      return db.getQuotationCount();
    }),
    create: protectedProcedure.input(z.object({
      quotationNumber: z.string().optional(),
      supplierId: z.number().optional(),
      locationId: z.number().optional(),
      quotationDate: z.string().optional(),
      expiryDate: z.string().optional(),
      subtotal: z.string().optional(),
      gst: z.string().optional(),
      qst: z.string().optional(),
      total: z.string().optional(),
      advanceRequired: z.boolean().optional(),
      advanceAmount: z.string().optional(),
      glAccount: z.string().optional(),
      notes: z.string().optional(),
    })).mutation(async ({ input }) => {
      const status = input.advanceRequired ? 'pending_advance' : 'draft';
      const advancePaidStatus = input.advanceRequired ? 'unpaid' : 'not_required';
      const id = await db.createQuotation({ ...input, status, advancePaidStatus });
      return { success: true, id };
    }),
    update: protectedProcedure.input(z.object({
      id: z.number(),
      quotationNumber: z.string().optional(),
      supplierId: z.number().optional(),
      locationId: z.number().optional(),
      quotationDate: z.string().optional(),
      expiryDate: z.string().optional(),
      subtotal: z.string().optional(),
      gst: z.string().optional(),
      qst: z.string().optional(),
      total: z.string().optional(),
      advanceRequired: z.boolean().optional(),
      advanceAmount: z.string().optional(),
      glAccount: z.string().optional(),
      notes: z.string().optional(),
    })).mutation(async ({ input }) => {
      const { id, ...data } = input;
      if (data.advanceRequired !== undefined) {
        (data as any).advancePaidStatus = data.advanceRequired ? 'unpaid' : 'not_required';
        (data as any).status = data.advanceRequired ? 'pending_advance' : 'draft';
      }
      await db.updateQuotation(id, data);
      return { success: true };
    }),
    updateStatus: protectedProcedure.input(z.object({ id: z.number(), status: z.string() })).mutation(async ({ input }) => {
      await db.updateQuotation(input.id, { status: input.status });
      return { success: true };
    }),
    markAdvancePaid: protectedProcedure.input(z.object({
      id: z.number(),
      paymentRef: z.string().optional(),
    })).mutation(async ({ input }) => {
      await db.updateQuotationAdvance(input.id, {
        advancePaidStatus: 'paid',
        advancePaidAt: new Date(),
        advancePaymentRef: input.paymentRef || null,
      });
      return { success: true };
    }),
    markAdvanceUnpaid: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      await db.updateQuotationAdvance(input.id, {
        advancePaidStatus: 'unpaid',
        advancePaidAt: null,
        advancePaymentRef: null,
      });
      return { success: true };
    }),
    convertToInvoice: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      const invoiceId = await db.convertQuotationToInvoice(input.id);
      return { success: true, invoiceId };
    }),
    uploadFile: protectedProcedure.input(z.object({
      quotationId: z.number(),
      fileData: z.string(),
      fileName: z.string(),
      contentType: z.string(),
    })).mutation(async ({ input }) => {
      const { storagePut } = await import('./storage');
      const buffer = Buffer.from(input.fileData, 'base64');
      const suffix = Math.random().toString(36).substring(2, 8);
      const key = `quotations/${input.quotationId}/file-${suffix}-${input.fileName}`;
      const { url } = await storagePut(key, buffer, input.contentType);
      await db.updateQuotationFile(input.quotationId, { fileUrl: url, fileKey: key });
      return { success: true, url, key };
    }),
  }),

  suppliers: router({
    list: publicProcedure.query(async () => {
      return db.getAllSuppliers();
    }),
  }),

  inventory: router({
    items: publicProcedure.query(async () => {
      return db.getAllInventoryItems();
    }),
    recipes: publicProcedure.query(async () => {
      return db.getAllRecipes();
    }),
    createIngredient: protectedProcedure.input(z.object({
      name: z.string(),
      category: z.string().optional(),
      unit: z.string(),
      purchaseAmount: z.string().optional(),
      purchaseCost: z.string().optional(),
      yieldPct: z.string().optional(),
      supplierName: z.string().optional(),
      notes: z.string().optional(),
    })).mutation(async ({ input }) => {
      return db.createIngredient(input);
    }),
    updateIngredient: protectedProcedure.input(z.object({
      id: z.number(),
      name: z.string().optional(),
      category: z.string().optional(),
      unit: z.string().optional(),
      purchaseAmount: z.string().optional(),
      purchaseCost: z.string().optional(),
      yieldPct: z.string().optional(),
      supplierName: z.string().optional(),
      notes: z.string().optional(),
    })).mutation(async ({ input }) => {
      const { id, ...data } = input;
      return db.updateIngredient(id, data);
    }),
  }),

  recipes: router({
    list: publicProcedure.query(async () => {
      return db.getAllRecipesWithIngredients();
    }),
    get: publicProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      return db.getRecipeWithIngredients(input.id);
    }),
    create: protectedProcedure.input(z.object({
      name: z.string(),
      category: z.string().optional(),
      sellingPrice: z.string().optional(),
      isSubRecipe: z.boolean().optional(),
      ingredients: z.array(z.object({
        ingredientName: z.string(),
        quantity: z.string(),
        unit: z.string(),
        inventoryItemId: z.number().nullable().optional(),
      })),
    })).mutation(async ({ input }) => {
      return db.createRecipe(input);
    }),
    update: protectedProcedure.input(z.object({
      id: z.number(),
      name: z.string().optional(),
      category: z.string().optional(),
      sellingPrice: z.string().optional(),
      isActive: z.boolean().optional(),
      ingredients: z.array(z.object({
        ingredientName: z.string(),
        quantity: z.string(),
        unit: z.string(),
        inventoryItemId: z.number().nullable().optional(),
      })).optional(),
    })).mutation(async ({ input }) => {
      const { id, ...data } = input;
      return db.updateRecipe(id, data);
    }),
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      return db.deleteRecipe(input.id);
    }),
    recalculateCosts: protectedProcedure.mutation(async () => {
      return db.recalculateAllRecipeCosts();
    }),
    duplicate: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      const original = await db.getRecipeWithIngredients(input.id);
      if (!original) throw new Error('Recipe not found');
      return db.createRecipe({
        name: `${original.name} (Copy)`,
        category: original.category || undefined,
        sellingPrice: original.sellingPrice || undefined,
        isSubRecipe: original.isSubRecipe || false,
        ingredients: original.ingredients.map(ing => ({
          ingredientName: ing.ingredientName,
          quantity: ing.quantity,
          unit: ing.unit || 'Kg',
          inventoryItemId: ing.inventoryItemId,
        })),
      });
    }),
    bulkImport: protectedProcedure.input(z.object({
      recipes: z.array(z.object({
        name: z.string(),
        category: z.string().optional(),
        sellingPrice: z.string().optional(),
        isSubRecipe: z.boolean().optional(),
        ingredients: z.array(z.object({
          ingredientName: z.string(),
          quantity: z.string(),
          unit: z.string(),
          inventoryItemId: z.number().nullable().optional(),
        })),
      })),
    })).mutation(async ({ input }) => {
      let created = 0;
      let skipped = 0;
      const existing = await db.getAllRecipesWithIngredients();
      const existingNames = new Set(existing.map(r => r.name.toLowerCase()));
      for (const recipe of input.recipes) {
        if (existingNames.has(recipe.name.toLowerCase())) {
          skipped++;
          continue;
        }
        await db.createRecipe(recipe);
        created++;
      }
      return { created, skipped, total: input.recipes.length };
    }),
  }),

  purchasing: router({
    orders: publicProcedure.query(async () => {
      const [orders, suppliers, locs] = await Promise.all([
        db.getAllPurchaseOrders(),
        db.getAllSuppliers(),
        db.getAllLocations(),
      ]);
      const supMap = new Map(suppliers.map(s => [s.id, s]));
      const locMap = new Map(locs.map(l => [l.id, l]));
      return orders.map(o => ({
        ...o,
        supplierName: supMap.get(o.supplierId)?.name || 'Unknown',
        locationName: locMap.get(o.locationId)?.name || 'Unknown',
      }));
    }),
  }),

  alerts: router({
    active: publicProcedure.query(async () => {
      return db.getActiveAlerts();
    }),
    dismiss: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      await db.markAlertRead(input.id);
      return { success: true };
    }),
  }),

  integrations: router({
    list: publicProcedure.query(async () => {
      return db.getAllIntegrations();
    }),
  }),

  sevenShifts: router({
    status: publicProcedure.query(async () => {
      return sevenShifts.getConnectionStatus();
    }),

      sync: protectedProcedure.mutation(async () => {
      return sevenShiftsScheduler.runSevenShiftsSync();
    }),
    schedulerStatus: publicProcedure.query(async () => {
      const status = sevenShiftsScheduler.getSevenShiftsSchedulerStatus();
      const enabled = await autoRetry.getSetting("7shifts_auto_sync_enabled");
      return { ...status, enabled: enabled === "true" };
    }),
    toggleScheduler: protectedProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ input }) => {
      await autoRetry.setSetting("7shifts_auto_sync_enabled", input.enabled ? "true" : "false");
      if (input.enabled) {
        sevenShiftsScheduler.startSevenShiftsScheduler();
      } else {
        sevenShiftsScheduler.stopSevenShiftsScheduler();
      }
      return { success: true, enabled: input.enabled };
    }),
  }),

  imports: router({
    logs: publicProcedure.query(async () => {
      return db.getImportLogs();
    }),

    parsePOS: protectedProcedure.input(z.object({
      data: z.array(z.record(z.string(), z.string())),
      fileName: z.string(),
      locationId: z.number(),
      columnMapping: z.object({
        saleDate: z.string(),
        totalSales: z.string(),
        taxExemptSales: z.string().optional(),
        taxableSales: z.string().optional(),
        gstCollected: z.string().optional(),
        qstCollected: z.string().optional(),
        totalDeposit: z.string().optional(),
        tipsCollected: z.string().optional(),
        merchantFees: z.string().optional(),
      }),
    })).mutation(async ({ input, ctx }) => {
      const logId = await db.createImportLog({
        importType: "pos_sales",
        fileName: input.fileName,
        locationId: input.locationId,
        importedBy: ctx.user?.name || "Unknown",
      });

      const rows: any[] = [];
      const errors: string[] = [];
      let skipped = 0;

      for (let i = 0; i < input.data.length; i++) {
        const raw = input.data[i];
        const dateVal = String(raw[input.columnMapping.saleDate] || "");
        const salesVal = String(raw[input.columnMapping.totalSales] || "");

        if (!dateVal || !salesVal) {
          skipped++;
          continue;
        }

        // Parse date - handle various formats
        let saleDate = dateVal;
        if (dateVal.includes('/')) {
          const parts = dateVal.split('/');
          if (parts.length === 3) {
            const [m, d, y] = parts;
            saleDate = `${y.length === 2 ? '20' + y : y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
          }
        }

        const parseNum = (key?: string) => {
          if (!key) return "0.00";
          const v = raw[key];
          if (!v) return "0.00";
          return String(parseFloat(String(v).replace(/[^0-9.-]/g, '')) || 0);
        };

        rows.push({
          locationId: input.locationId,
          saleDate,
          totalSales: parseNum(input.columnMapping.totalSales),
          taxExemptSales: parseNum(input.columnMapping.taxExemptSales),
          taxableSales: parseNum(input.columnMapping.taxableSales),
          gstCollected: parseNum(input.columnMapping.gstCollected),
          qstCollected: parseNum(input.columnMapping.qstCollected),
          totalDeposit: parseNum(input.columnMapping.totalDeposit),
          tipsCollected: parseNum(input.columnMapping.tipsCollected),
          merchantFees: parseNum(input.columnMapping.merchantFees),
        });
      }

      try {
        const imported = await db.bulkInsertDailySales(rows);
        if (logId) {
          const dates = rows.map(r => r.saleDate).sort();
          await db.updateImportLog(logId, {
            status: "completed",
            recordsFound: input.data.length,
            recordsImported: imported,
            recordsSkipped: skipped,
            recordsFailed: errors.length,
            dateRangeStart: dates[0],
            dateRangeEnd: dates[dates.length - 1],
            errors: errors.length > 0 ? errors : null,
            completedAt: new Date(),
          });
        }
        return { success: true, imported, skipped, errors };
      } catch (err: any) {
        if (logId) {
          await db.updateImportLog(logId, {
            status: "failed",
            recordsFound: input.data.length,
            errors: [err.message],
            completedAt: new Date(),
          });
        }
        throw err;
      }
    }),

    parsePayroll: protectedProcedure.input(z.object({
      data: z.array(z.record(z.string(), z.string())),
      fileName: z.string(),
      locationId: z.number(),
      columnMapping: z.object({
        payDate: z.string(),
        grossWages: z.string(),
        periodStart: z.string().optional(),
        periodEnd: z.string().optional(),
        employerContributions: z.string().optional(),
        netPayroll: z.string().optional(),
        headcount: z.string().optional(),
        totalHours: z.string().optional(),
      }),
    })).mutation(async ({ input, ctx }) => {
      const logId = await db.createImportLog({
        importType: "payroll",
        fileName: input.fileName,
        locationId: input.locationId,
        importedBy: ctx.user?.name || "Unknown",
      });

      const rows: any[] = [];
      const errors: string[] = [];
      let skipped = 0;

      for (let i = 0; i < input.data.length; i++) {
        const raw = input.data[i];
        const dateVal = String(raw[input.columnMapping.payDate] || "");
        const wagesVal = String(raw[input.columnMapping.grossWages] || "");

        if (!dateVal || !wagesVal) {
          skipped++;
          continue;
        }

        let payDate = dateVal;
        if (dateVal.includes('/')) {
          const parts = dateVal.split('/');
          if (parts.length === 3) {
            const [m, d, y] = parts;
            payDate = `${y.length === 2 ? '20' + y : y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
          }
        }

        const parseNum = (key?: string) => {
          if (!key) return "0.00";
          const v = raw[key];
          if (!v) return "0.00";
          return String(parseFloat(String(v).replace(/[^0-9.-]/g, '')) || 0);
        };

        const parseInt2 = (key?: string) => {
          if (!key) return 0;
          const v = raw[key];
          if (!v) return 0;
          return Math.round(parseFloat(String(v).replace(/[^0-9.-]/g, '')) || 0);
        };

        const parseDateOpt = (key?: string) => {
          if (!key) return undefined;
          const v = String(raw[key] || "");
          if (!v) return undefined;
          if (v.includes('/')) {
            const parts = v.split('/');
            if (parts.length === 3) {
              const [m, d, y] = parts;
              return `${y.length === 2 ? '20' + y : y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
            }
          }
          return v;
        };

        rows.push({
          locationId: input.locationId,
          payDate,
          periodStart: parseDateOpt(input.columnMapping.periodStart),
          periodEnd: parseDateOpt(input.columnMapping.periodEnd),
          grossWages: parseNum(input.columnMapping.grossWages),
          employerContributions: parseNum(input.columnMapping.employerContributions),
          netPayroll: parseNum(input.columnMapping.netPayroll),
          headcount: parseInt2(input.columnMapping.headcount),
          totalHours: parseNum(input.columnMapping.totalHours),
        });
      }

      try {
        const imported = await db.bulkInsertPayroll(rows);
        if (logId) {
          const dates = rows.map(r => r.payDate).sort();
          await db.updateImportLog(logId, {
            status: "completed",
            recordsFound: input.data.length,
            recordsImported: imported,
            recordsSkipped: skipped,
            dateRangeStart: dates[0],
            dateRangeEnd: dates[dates.length - 1],
            completedAt: new Date(),
          });
        }
        return { success: true, imported, skipped, errors };
      } catch (err: any) {
        if (logId) {
          await db.updateImportLog(logId, {
            status: "failed",
            recordsFound: input.data.length,
            errors: [err.message],
            completedAt: new Date(),
          });
        }
        throw err;
      }
    }),

    parseBankStatement: protectedProcedure.input(z.object({
      data: z.array(z.record(z.string(), z.string())),
      fileName: z.string(),
      accountName: z.string().optional(),
      locationId: z.number(),
      bankAccountId: z.number().optional(),
      columnMapping: z.object({
        transactionDate: z.string(),
        description: z.string(),
        debit: z.string().optional(),
        credit: z.string().optional(),
        amount: z.string().optional(),
        balance: z.string().optional(),
      }),
    })).mutation(async ({ input, ctx }) => {
      const logId = await db.createImportLog({
        importType: "bank_statement",
        fileName: input.fileName,
        locationId: input.locationId,
        importedBy: ctx.user?.name || "Unknown",
      });

      const rows: any[] = [];
      let skipped = 0;

      for (const raw of input.data) {
        const dateVal = String(raw[input.columnMapping.transactionDate] || "");
        const desc = String(raw[input.columnMapping.description] || "");

        if (!dateVal) {
          skipped++;
          continue;
        }

        let txDate = dateVal;
        if (dateVal.includes('/')) {
          const parts = dateVal.split('/');
          if (parts.length === 3) {
            const [m, d, y] = parts;
            txDate = `${y.length === 2 ? '20' + y : y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
          }
        }

        const parseNum = (key?: string) => {
          if (!key) return "0.00";
          const v = raw[key];
          if (!v) return "0.00";
          return String(parseFloat(String(v).replace(/[^0-9.-]/g, '')) || 0);
        };

        let debit = "0.00";
        let credit = "0.00";

        if (input.columnMapping.amount) {
          const amt = parseFloat(parseNum(input.columnMapping.amount));
          if (amt < 0) debit = String(Math.abs(amt));
          else credit = String(amt);
        } else {
          debit = parseNum(input.columnMapping.debit);
          credit = parseNum(input.columnMapping.credit);
        }

        // Auto-detect intercompany transfers
        let matchedType: string = "unmatched";
        const descLower = String(desc || "").toLowerCase();
        if (descLower.includes("transfer") || descLower.includes("virement")) {
          matchedType = "intercompany";
        } else if (descLower.includes("payroll") || descLower.includes("adp") || descLower.includes("paie")) {
          matchedType = "payroll";
        } else if (descLower.includes("deposit") || descLower.includes("depôt")) {
          matchedType = "sales_deposit";
        }

        // Use bank account name if available, otherwise use provided accountName
        rows.push({
          accountName: input.accountName || null,
          transactionDate: txDate,
          description: desc || null,
          debit,
          credit,
          balance: parseNum(input.columnMapping.balance),
          matchedType,
          locationId: input.locationId,
          importLogId: logId || null,
        });
      }

      try {
        const imported = await db.bulkInsertBankTransactions(rows);
        if (logId) {
          const dates = rows.map(r => r.transactionDate).sort();
          await db.updateImportLog(logId, {
            status: "completed",
            recordsFound: input.data.length,
            recordsImported: imported,
            recordsSkipped: skipped,
            dateRangeStart: dates[0],
            dateRangeEnd: dates[dates.length - 1],
            completedAt: new Date(),
          });
        }
        return { success: true, imported, skipped };
      } catch (err: any) {
        if (logId) {
          await db.updateImportLog(logId, {
            status: "failed",
            recordsFound: input.data.length,
            errors: [err.message],
            completedAt: new Date(),
          });
        }
        throw err;
      }
    }),

    parseLightspeedDay: protectedProcedure.input(z.object({
      data: z.array(z.record(z.string(), z.string())),
      fileName: z.string(),
      locationId: z.number(),
      columnMapping: z.object({
        saleDate: z.string(),
        totalSales: z.string(),
        receipts: z.string().optional(),
        avgReceipt: z.string().optional(),
        discounts: z.string().optional(),
        refunds: z.string().optional(),
        taxes: z.string().optional(),
        tips: z.string().optional(),
      }),
    })).mutation(async ({ input, ctx }) => {
      const logId = await db.createImportLog({
        importType: "pos_sales",
        fileName: input.fileName,
        locationId: input.locationId,
        importedBy: ctx.user?.name || "Unknown",
      });

      const rows: any[] = [];
      const errors: string[] = [];
      let skipped = 0;

      for (let i = 0; i < input.data.length; i++) {
        const raw = input.data[i];
        const dateVal = String(raw[input.columnMapping.saleDate] || "").trim();
        const salesVal = String(raw[input.columnMapping.totalSales] || "").trim();

        if (!dateVal || !salesVal) {
          skipped++;
          continue;
        }

        // Parse date - handle YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, etc.
        let saleDate = dateVal;
        if (dateVal.includes('/')) {
          const parts = dateVal.split('/');
          if (parts.length === 3) {
            // Try YYYY/MM/DD first, then MM/DD/YYYY, then DD/MM/YYYY
            if (parts[0].length === 4) {
              saleDate = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
            } else {
              const [a, b, y] = parts;
              const year = y.length === 2 ? '20' + y : y;
              // If first part > 12, it's DD/MM/YYYY
              if (parseInt(a) > 12) {
                saleDate = `${year}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
              } else {
                saleDate = `${year}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
              }
            }
          }
        } else if (dateVal.includes('-') && dateVal.split('-')[0].length !== 4) {
          // DD-MM-YYYY format
          const parts = dateVal.split('-');
          if (parts.length === 3) {
            saleDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
          }
        }

        const parseNum = (key?: string) => {
          if (!key) return "0.00";
          const v = raw[key];
          if (!v) return "0.00";
          return String(parseFloat(String(v).replace(/[^0-9.-]/g, '')) || 0);
        };

        const parseIntNum = (key?: string) => {
          if (!key) return 0;
          const v = raw[key];
          if (!v) return 0;
          return Math.round(parseFloat(String(v).replace(/[^0-9.-]/g, '')) || 0);
        };

        rows.push({
          locationId: input.locationId,
          saleDate,
          totalSales: parseNum(input.columnMapping.totalSales),
          orderCount: parseIntNum(input.columnMapping.receipts),
          tipsCollected: parseNum(input.columnMapping.tips),
        });
      }

      try {
        let inserted = 0;
        let updated = 0;
        for (const row of rows) {
          const result = await db.upsertDailySale({
            locationId: row.locationId,
            saleDate: row.saleDate,
            totalSales: row.totalSales,
            orderCount: row.orderCount,
            tipsCollected: row.tipsCollected,
          });
          if (result === "inserted") inserted++;
          else updated++;
        }
        if (logId) {
          const dates = rows.map(r => r.saleDate).sort();
          await db.updateImportLog(logId, {
            status: "completed",
            recordsFound: input.data.length,
            recordsImported: inserted + updated,
            recordsSkipped: skipped,
            recordsFailed: errors.length,
            dateRangeStart: dates[0],
            dateRangeEnd: dates[dates.length - 1],
            errors: errors.length > 0 ? errors : null,
            completedAt: new Date(),
          });
        }
        return { success: true, imported: inserted + updated, skipped, inserted, updated, errors };
      } catch (err: any) {
        if (logId) {
          await db.updateImportLog(logId, {
            status: "failed",
            recordsFound: input.data.length,
            errors: [err.message],
            completedAt: new Date(),
          });
        }
        throw err;
      }
    }),

    parseLightspeedPayments: protectedProcedure.input(z.object({
      data: z.array(z.record(z.string(), z.string())),
      fileName: z.string(),
      locationId: z.number(),
      columnMapping: z.object({
        paymentDate: z.string(),
        paymentMethod: z.string(),
        amount: z.string(),
        receipts: z.string().optional(),
        tips: z.string().optional(),
      }),
    })).mutation(async ({ input, ctx }) => {
      const logId = await db.createImportLog({
        importType: "pos_sales",
        fileName: input.fileName,
        locationId: input.locationId,
        importedBy: ctx.user?.name || "Unknown",
      });

      // Aggregate payments by date (multiple payment methods per day)
      const dailyTotals = new Map<string, { totalSales: number; orderCount: number; tips: number; methods: string[] }>();
      let skipped = 0;

      for (const raw of input.data) {
        const dateVal = String(raw[input.columnMapping.paymentDate] || "").trim();
        const amtVal = String(raw[input.columnMapping.amount] || "").trim();
        const method = String(raw[input.columnMapping.paymentMethod] || "").trim();

        if (!dateVal || !amtVal) {
          skipped++;
          continue;
        }

        let payDate = dateVal;
        if (dateVal.includes('/')) {
          const parts = dateVal.split('/');
          if (parts.length === 3) {
            if (parts[0].length === 4) {
              payDate = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
            } else {
              const [a, b, y] = parts;
              const year = y.length === 2 ? '20' + y : y;
              if (parseInt(a) > 12) {
                payDate = `${year}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
              } else {
                payDate = `${year}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
              }
            }
          }
        }

        const amt = parseFloat(amtVal.replace(/[^0-9.-]/g, '')) || 0;
        const tipVal = input.columnMapping.tips ? parseFloat(String(raw[input.columnMapping.tips] || "0").replace(/[^0-9.-]/g, '')) || 0 : 0;
        const rcptVal = input.columnMapping.receipts ? Math.round(parseFloat(String(raw[input.columnMapping.receipts] || "0").replace(/[^0-9.-]/g, '')) || 0) : 0;

        const existing = dailyTotals.get(payDate) || { totalSales: 0, orderCount: 0, tips: 0, methods: [] };
        existing.totalSales += amt;
        existing.orderCount += rcptVal;
        existing.tips += tipVal;
        if (method && !existing.methods.includes(method)) existing.methods.push(method);
        dailyTotals.set(payDate, existing);
      }

      try {
        let inserted = 0;
        let updated = 0;
        for (const [saleDate, totals] of Array.from(dailyTotals.entries())) {
          const result = await db.upsertDailySale({
            locationId: input.locationId,
            saleDate,
            totalSales: String(totals.totalSales.toFixed(2)),
            orderCount: totals.orderCount,
            tipsCollected: String(totals.tips.toFixed(2)),
          });
          if (result === "inserted") inserted++;
          else updated++;
        }
        if (logId) {
          const dates = Array.from(dailyTotals.keys()).sort() as string[];
          await db.updateImportLog(logId, {
            status: "completed",
            recordsFound: input.data.length,
            recordsImported: inserted + updated,
            recordsSkipped: skipped,
            dateRangeStart: dates[0],
            dateRangeEnd: dates[dates.length - 1],
            completedAt: new Date(),
          });
        }
        return { success: true, imported: inserted + updated, skipped, inserted, updated, daysProcessed: dailyTotals.size };
      } catch (err: any) {
        if (logId) {
          await db.updateImportLog(logId, {
            status: "failed",
            recordsFound: input.data.length,
            errors: [err.message],
            completedAt: new Date(),
          });
        }
        throw err;
      }
    }),
  }),

  workforce: router({
    payroll: publicProcedure.input(z.object({
      startDate: z.string(),
      endDate: z.string(),
    })).query(async ({ input }) => {
      const [payroll, locs] = await Promise.all([
        db.getPayrollRange(input.startDate, input.endDate),
        db.getAllLocations(),
      ]);
      const locMap = new Map(locs.map(l => [l.id, l]));
      return payroll.map(p => ({
        ...p,
        locationName: locMap.get(p.locationId)?.name || 'Unknown',
      }));
    }),
    laborTargets: publicProcedure.query(async () => {
      return db.getAllLocations();
    }),
  }),

  qbo: router({
    status: publicProcedure.query(async () => {
      return qbo.getQboConnectionStatus();
    }),

    getAuthUrl: protectedProcedure.input(z.object({ origin: z.string() })).mutation(async ({ input }) => {
      const redirectUri = `${input.origin}/api/qbo/callback`;
      const state = JSON.stringify({ origin: input.origin, redirectUri });
      const stateB64 = Buffer.from(state).toString("base64");
      const url = qbo.getQboAuthUrl(redirectUri, stateB64);
      return { url };
    }),

    disconnect: protectedProcedure.mutation(async () => {
      const tokens = await qbo.getActiveTokens();
      if (tokens) {
        const dbConn = await db.getDb();
        if (dbConn) {
          const { qboTokens } = await import("../drizzle/schema");
          const { eq } = await import("drizzle-orm");
          await dbConn.update(qboTokens).set({ isActive: false }).where(eq(qboTokens.id, tokens.id));
        }
      }
      return { success: true };
    }),

    companyInfo: protectedProcedure.query(async () => {
      try {
        return await qbo.getCompanyInfo();
      } catch (err: any) {
        return { error: err.message };
      }
    }),

    vendors: protectedProcedure.query(async () => {
      try {
        return await qbo.getVendors();
      } catch (err: any) {
        return { error: err.message };
      }
    }),

    accounts: protectedProcedure.query(async () => {
      try {
        return await qbo.getAccounts();
      } catch (err: any) {
        return { error: err.message };
      }
    }),

    createBill: protectedProcedure.input(z.object({
      vendorName: z.string(),
      vendorId: z.string().optional(),
      txnDate: z.string(),
      dueDate: z.string().optional(),
      docNumber: z.string().optional(),
      lineItems: z.array(z.object({
        description: z.string(),
        amount: z.number(),
        accountId: z.string().optional(),
        accountName: z.string().optional(),
      })),
    })).mutation(async ({ input }) => {
      return await qbo.createBill(input);
    }),

    createJournalEntry: protectedProcedure.input(z.object({
      txnDate: z.string(),
      docNumber: z.string().optional(),
      privateNote: z.string().optional(),
      lines: z.array(z.object({
        postingType: z.enum(["Debit", "Credit"]),
        amount: z.number(),
        accountId: z.string(),
        accountName: z.string().optional(),
        description: z.string().optional(),
        className: z.string().optional(),
        classId: z.string().optional(),
      })),
    })).mutation(async ({ input }) => {
      return await qbo.createJournalEntry(input);
    }),

    generatePayrollJE: protectedProcedure.input(z.object({
      payrollRecordId: z.number().optional(),
      locationId: z.number(),
      payDate: z.string(),
      grossWages: z.number(),
      employerContributions: z.number(),
      netPayroll: z.number(),
    })).mutation(async ({ input }) => {
      const locs = await db.getAllLocations();
      const loc = locs.find(l => l.id === input.locationId);
      const locName = loc?.name || "Unknown Location";
      const locCode = loc?.code || "UNK";

      // Payroll JE: Debit Wages Expense + Employer Contributions, Credit Payroll Payable
      const lines = [
        {
          postingType: "Debit" as const,
          amount: input.grossWages,
          accountId: "1", // Wages Expense - will be matched in QBO
          accountName: "Wages Expense",
          description: `Payroll - ${locName} - ${input.payDate}`,
          className: locCode,
        },
        {
          postingType: "Debit" as const,
          amount: input.employerContributions,
          accountId: "1",
          accountName: "Employer Payroll Taxes",
          description: `Employer contributions - ${locName} - ${input.payDate}`,
          className: locCode,
        },
        {
          postingType: "Credit" as const,
          amount: input.netPayroll,
          accountId: "1",
          accountName: "Payroll Payable",
          description: `Net payroll - ${locName} - ${input.payDate}`,
          className: locCode,
        },
        {
          postingType: "Credit" as const,
          amount: Number((input.grossWages + input.employerContributions - input.netPayroll).toFixed(2)),
          accountId: "1",
          accountName: "Payroll Deductions Payable",
          description: `Payroll deductions - ${locName} - ${input.payDate}`,
          className: locCode,
        },
      ];

      const result = await qbo.createJournalEntry({
        txnDate: input.payDate,
        docNumber: `PR-${locCode}-${input.payDate}`,
        privateNote: `Payroll entry for ${locName} - Pay date: ${input.payDate}`,
        lines,
      });

      return { success: true, journalEntryId: result?.JournalEntry?.Id };
    }),

    generateRevenueJE: protectedProcedure.input(z.object({
      date: z.string(),
      locationId: z.number(),
    })).mutation(async ({ input }) => {
      const sales = await db.getDailySalesForDate(input.date);
      const sale = sales.find(s => s.locationId === input.locationId);
      if (!sale) throw new Error(`No sales data for location ${input.locationId} on ${input.date}`);

      const locs = await db.getAllLocations();
      const loc = locs.find(l => l.id === input.locationId);
      const locName = loc?.name || "Unknown";
      const locCode = loc?.code || "UNK";

      const totalSales = Math.round(Number(sale.totalSales) * 100) / 100;
      const gst = Math.round(Number(sale.gstCollected || 0) * 100) / 100;
      const qst = Math.round(Number(sale.qstCollected || 0) * 100) / 100;
      const netRevenue = Math.round((totalSales - gst - qst) * 100) / 100;

      // Balanced Revenue JE:
      // DEBIT  Undeposited Funds = totalSales (gross receipts incl. taxes)
      // CREDIT Sales Revenue     = totalSales - GST - QST (net revenue)
      // CREDIT GST Payable       = GST collected
      // CREDIT QST Payable       = QST collected
      const lines: Array<{ postingType: "Debit" | "Credit"; amount: number; accountId: string; accountName: string; description: string; className: string }> = [];

      // Debit: Undeposited Funds = totalSales
      lines.push({
        postingType: "Debit",
        amount: totalSales,
        accountId: "92",
        accountName: "Undeposited Funds",
        description: `Daily sales - ${locName} - ${input.date}`,
        className: locCode,
      });

      // Credit: Revenue (net of taxes)
      lines.push({
        postingType: "Credit",
        amount: netRevenue,
        accountId: "96",
        accountName: "Sales",
        description: `Daily revenue - ${locName} - ${input.date}`,
        className: locCode,
      });

      // Credit: GST Collected
      if (gst > 0) {
        lines.push({
          postingType: "Credit",
          amount: gst,
          accountId: "149",
          accountName: "GST Payable",
          description: `GST collected - ${locName} - ${input.date}`,
          className: locCode,
        });
      }

      // Credit: QST Collected
      if (qst > 0) {
        lines.push({
          postingType: "Credit",
          amount: qst,
          accountId: "150",
          accountName: "QST Payable",
          description: `QST collected - ${locName} - ${input.date}`,
          className: locCode,
        });
      }

      const result = await qbo.createJournalEntry({
        txnDate: input.date,
        docNumber: `REV-${locCode}-${input.date}`,
        privateNote: `Daily revenue entry for ${locName} - ${input.date}`,
        lines,
      });

      return { success: true, journalEntryId: result?.JournalEntry?.Id };
    }),

    // ─── Chart of Accounts ───
    chartOfAccounts: protectedProcedure.input(z.object({
      accountType: z.string().optional(),
    }).optional()).query(async ({ input }) => {
      try {
        const accounts = await qbo.getAccountsByType(input?.accountType);
        return { accounts, error: null };
      } catch (err: any) {
        return { accounts: [], error: err.message };
      }
    }),

    bankAccountsQbo: protectedProcedure.query(async () => {
      try {
        const accounts = await qbo.getBankAccounts();
        return { accounts, error: null };
      } catch (err: any) {
        return { accounts: [], error: err.message };
      }
    }),

    expenseAccountsQbo: protectedProcedure.query(async () => {
      try {
        const accounts = await qbo.getExpenseAccounts();
        return { accounts, error: null };
      } catch (err: any) {
        return { accounts: [], error: err.message };
      }
    }),

    createAccountInQbo: protectedProcedure.input(z.object({
      name: z.string(),
      accountType: z.string(),
      accountSubType: z.string().optional(),
      acctNum: z.string().optional(),
      description: z.string().optional(),
      currencyCode: z.string().optional(),
    })).mutation(async ({ input }) => {
      const account = await qbo.createAccount({
        name: input.name,
        accountType: input.accountType as qbo.QboAccountType,
        accountSubType: input.accountSubType as qbo.QboAccountSubType,
        acctNum: input.acctNum,
        description: input.description,
        currencyCode: input.currencyCode,
      });
      return { account };
    }),

    linkBankAccountToQbo: protectedProcedure.input(z.object({
      localBankAccountId: z.number(),
      qboAccountId: z.string(),
    })).mutation(async ({ input }) => {
      await db.updateBankAccount(input.localBankAccountId, {
        qboAccountId: input.qboAccountId,
      });
      return { success: true };
    }),

    unlinkBankAccountFromQbo: protectedProcedure.input(z.object({
      localBankAccountId: z.number(),
    })).mutation(async ({ input }) => {
      await db.updateBankAccount(input.localBankAccountId, {
        qboAccountId: undefined,
      });
      return { success: true };
    }),

    autoCreateBankAccounts: protectedProcedure.mutation(async () => {
      // Get all local bank accounts
      const localAccounts = await db.listBankAccounts();
      const results: Array<{ localId: number; name: string; qboAccountId: string | null; status: string; error?: string }> = [];

      for (const local of localAccounts) {
        // Skip already linked
        if (local.qboAccountId) {
          results.push({ localId: local.id, name: local.name, qboAccountId: local.qboAccountId, status: "already_linked" });
          continue;
        }

        try {
          // Check if an account with the same name already exists in QBO
          const existingAccounts = await qbo.getBankAccounts();
          const existing = existingAccounts.find(a => a.Name === local.name || a.AcctNum === local.accountNumber);

          if (existing) {
            // Link to existing QBO account
            await db.updateBankAccount(local.id, { qboAccountId: existing.Id });
            results.push({ localId: local.id, name: local.name, qboAccountId: existing.Id, status: "linked_existing" });
          } else {
            // Create new account in QBO
            const qboAccount = await qbo.createBankAccountInQbo({
              name: local.name,
              bankName: local.bankName,
              accountNumber: local.accountNumber,
              accountType: local.accountType || "checking",
              currency: local.currency || "CAD",
            });

            // Link the new QBO account
            await db.updateBankAccount(local.id, { qboAccountId: qboAccount.Id });
            results.push({ localId: local.id, name: local.name, qboAccountId: qboAccount.Id, status: "created" });
          }
        } catch (err: any) {
          results.push({ localId: local.id, name: local.name, qboAccountId: null, status: "error", error: err.message });
        }
      }

      return { results, summary: {
        total: results.length,
        created: results.filter(r => r.status === "created").length,
        linkedExisting: results.filter(r => r.status === "linked_existing").length,
        alreadyLinked: results.filter(r => r.status === "already_linked").length,
        errors: results.filter(r => r.status === "error").length,
      }};
    }),

    syncInvoice: protectedProcedure.input(z.object({
      invoiceId: z.number(),
    })).mutation(async ({ input }) => {
      // Mark as pending sync
      await db.updateInvoiceQboSync(input.invoiceId, {
        qboSyncStatus: "pending",
        qboSyncError: null,
      });

      try {
        // Get invoice details from our DB
        const invoices = await db.getInvoices();
        const inv = invoices.find(i => i.id === input.invoiceId);
        if (!inv) throw new Error("Invoice not found");

        const suppliers = await db.getAllSuppliers();
        const supplier = suppliers.find(s => s.id === inv.supplierId);

        const result = await qbo.createBill({
          vendorName: supplier?.name || "Unknown Vendor",
          txnDate: String(inv.invoiceDate),
          dueDate: inv.dueDate ? String(inv.dueDate) : undefined,
          docNumber: inv.invoiceNumber || undefined,
          lineItems: [{
            description: `Invoice ${inv.invoiceNumber || inv.id} - ${supplier?.name || "Vendor"}`,
            amount: Number(inv.subtotal),
          }],
        });

        // Mark as synced in our DB
        await db.updateInvoiceQboSync(input.invoiceId, {
          qboSynced: true,
          qboSyncStatus: "synced",
          qboSyncError: null,
          qboSyncedAt: new Date(),
          qboBillId: result?.Bill?.Id ? String(result.Bill.Id) : null,
        });

        return { success: true, qboBillId: result?.Bill?.Id };
      } catch (error: any) {
        // Mark as failed with error message
        await db.updateInvoiceQboSync(input.invoiceId, {
          qboSynced: false,
          qboSyncStatus: "failed",
          qboSyncError: error?.message || "Unknown sync error",
        });
        throw error;
      }
    }),
  }),

  scheduler: router({
    status: publicProcedure.query(async () => {
      const schedulerStatus = autoRetry.getSchedulerStatus();
      const enabled = await autoRetry.getSetting("qbo_auto_retry_enabled");
      return {
        ...schedulerStatus,
        enabled: enabled === "true",
      };
    }),

    toggle: protectedProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ input }) => {
      await autoRetry.setSetting("qbo_auto_retry_enabled", input.enabled ? "true" : "false");
      if (input.enabled) {
        autoRetry.startAutoRetryScheduler();
      } else {
        autoRetry.stopAutoRetryScheduler();
      }
      return { success: true, enabled: input.enabled };
    }),

    runNow: protectedProcedure.mutation(async () => {
      const result = await autoRetry.runAutoRetry();
      return result;
    }),

    syncLogs: publicProcedure.input(z.object({ limit: z.number().optional() }).optional()).query(async ({ input }) => {
      return autoRetry.getRecentSyncLogs(input?.limit || 50);
    }),
  }),

  reporting: router({
    dailyPnl: publicProcedure.input(z.object({ date: z.string() })).query(async ({ input }) => {
      return db.getDailyPnlForDate(input.date);
    }),
    dateRange: publicProcedure.query(async () => {
      return db.getLatestSaleDate();
    }),
    monthlyAggregated: publicProcedure.input(z.object({ year: z.number(), locationIds: z.array(z.number()).optional() })).query(async ({ input }) => {
      return db.getMonthlyAggregatedSummary(input.year, input.locationIds);
    }),
    monthlySummaryByLocation: publicProcedure.input(z.object({ year: z.number(), locationIds: z.array(z.number()).optional() })).query(async ({ input }) => {
      return db.getMonthlySalesSummary(input.year, input.locationIds);
    }),
    locationsWithData: publicProcedure.query(async () => {
      return db.getLocationIdsWithSalesData();
    }),
  }),

  productSales: router({
    import: protectedProcedure.input(z.object({
      locationId: z.number(),
      rows: z.array(z.object({
        periodStart: z.string(),
        periodEnd: z.string(),
        section: z.enum(["items", "options"]),
        itemName: z.string(),
        category: z.string().nullable(),
        groupName: z.string().nullable(),
        totalRevenue: z.string(),
        quantitySold: z.number(),
        quantityRefunded: z.number(),
      })),
      fileName: z.string(),
    })).mutation(async ({ input, ctx }) => {
      const logId = await db.createImportLog({
        importType: "product_sales",
        fileName: input.fileName,
        locationId: input.locationId,
        importedBy: ctx.user?.name || "Unknown",
      });
      const rowsWithLocation = input.rows.map(r => ({ ...r, locationId: input.locationId }));
      const result = await db.importProductSales(rowsWithLocation);
      await db.updateImportLog(logId, {
        status: "completed",
        recordsFound: input.rows.length,
        recordsImported: result.imported,
        recordsSkipped: result.skipped,
      });
      return { ...result, logId };
    }),

    summary: publicProcedure.input(z.object({
      locationId: z.number().optional(),
      periodStart: z.string().optional(),
      periodEnd: z.string().optional(),
    }).optional()).query(async ({ input }) => {
      return db.getProductSalesSummary(input?.locationId, input?.periodStart, input?.periodEnd);
    }),

    categories: publicProcedure.input(z.object({
      locationId: z.number().optional(),
    }).optional()).query(async ({ input }) => {
      return db.getProductSalesCategories(input?.locationId);
    }),

    periods: publicProcedure.input(z.object({
      locationId: z.number().optional(),
    }).optional()).query(async ({ input }) => {
      return db.getProductSalesPeriods(input?.locationId);
    }),

    withCosts: publicProcedure.input(z.object({
      locationId: z.number().optional(),
      periodStart: z.string().optional(),
      periodEnd: z.string().optional(),
      category: z.string().optional(),
    }).optional()).query(async ({ input }) => {
      return db.getProductSalesWithCosts(input?.locationId, input?.periodStart, input?.periodEnd, input?.category);
    }),

    monthOverMonth: publicProcedure.input(z.object({
      locationId: z.number().optional(),
      currentPeriodStart: z.string().optional(),
      currentPeriodEnd: z.string().optional(),
    }).optional()).query(async ({ input }) => {
      return db.getProductSalesMoM(input?.locationId, input?.currentPeriodStart, input?.currentPeriodEnd);
    }),

    menuEngineering: publicProcedure.input(z.object({
      locationId: z.number().optional(),
      periodStart: z.string().optional(),
      periodEnd: z.string().optional(),
    }).optional()).query(async ({ input }) => {
      return db.getMenuEngineering(input?.locationId, input?.periodStart, input?.periodEnd);
    }),
  }),

  menuItems: router({
    list: publicProcedure.query(async () => {
      return db.getAllMenuItems();
    }),
    withoutRecipes: publicProcedure.query(async () => {
      return db.getMenuItemsWithoutRecipes();
    }),
    withRecipes: publicProcedure.query(async () => {
      return db.getMenuItemsWithRecipes();
    }),
    summary: publicProcedure.query(async () => {
      return db.getMenuItemsSummary();
    }),
    updateCogs: protectedProcedure.input(z.object({
      id: z.number(),
      cogsPct: z.string(),
    })).mutation(async ({ input }) => {
      return db.updateMenuItemCogs(input.id, input.cogsPct);
    }),
    bulkUpdateCogs: protectedProcedure.input(z.object({
      updates: z.array(z.object({ id: z.number(), cogsPct: z.string() })),
    })).mutation(async ({ input }) => {
      return db.bulkUpdateMenuItemCogs(input.updates);
    }),
    create: protectedProcedure.input(z.object({
      name: z.string().min(1),
      category: z.string().optional(),
      sellingPrice: z.string().optional(),
      defaultCogsPct: z.string().optional(),
    })).mutation(async ({ input }) => {
      return db.createMenuItem(input);
    }),
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      return db.deleteMenuItem(input.id);
    }),
    linkRecipe: protectedProcedure.input(z.object({
      menuItemId: z.number(),
      recipeId: z.number(),
    })).mutation(async ({ input }) => {
      return db.linkMenuItemToRecipe(input.menuItemId, input.recipeId);
    }),
     unlinkRecipe: protectedProcedure.input(z.object({
      menuItemId: z.number(),
    })).mutation(async ({ input }) => {
      return db.unlinkMenuItemFromRecipe(input.menuItemId);
    }),
  }),

  cfo: router({
    profitability: publicProcedure.input(z.object({
      startDate: z.string(),
      endDate: z.string(),
    })).query(async ({ input }) => {
      return db.getCFOProfitability(input.startDate, input.endDate);
    }),

    revenueTrends: publicProcedure.input(z.object({
      locationId: z.number().optional(),
    }).optional()).query(async ({ input }) => {
      return db.getCFORevenueTrends(input?.locationId);
    }),

    laborEfficiency: publicProcedure.input(z.object({
      startDate: z.string(),
      endDate: z.string(),
    })).query(async ({ input }) => {
      return db.getCFOLaborEfficiency(input.startDate, input.endDate);
    }),

    seasonalHeatmap: publicProcedure.input(z.object({
      locationId: z.number().optional(),
    }).optional()).query(async ({ input }) => {
      return db.getSeasonalHeatmap(input?.locationId);
    }),

    cashFlowForecast: publicProcedure.query(async () => {
      return db.getCashFlowForecast();
    }),
  }),

  bankAccounts: router({
    list: publicProcedure.query(async () => {
      return db.listBankAccounts();
    }),
    byLocation: publicProcedure.input(z.object({ locationId: z.number() })).query(async ({ input }) => {
      return db.getBankAccountsByLocation(input.locationId);
    }),
    create: protectedProcedure.input(z.object({
      name: z.string(),
      bankName: z.string().optional(),
      accountNumber: z.string().optional(),
      locationId: z.number(),
      accountType: z.enum(["checking", "savings", "credit_card"]).optional(),
      currency: z.string().optional(),
    })).mutation(async ({ input }) => {
      const id = await db.createBankAccount(input);
      return { id };
    }),
    update: protectedProcedure.input(z.object({
      id: z.number(),
      name: z.string().optional(),
      bankName: z.string().optional(),
      accountNumber: z.string().optional(),
      accountType: z.enum(["checking", "savings", "credit_card"]).optional(),
      currency: z.string().optional(),
      qboAccountId: z.string().optional(),
      isActive: z.boolean().optional(),
    })).mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateBankAccount(id, data);
      return { success: true };
    }),
    bankCoverage: publicProcedure.query(async () => {
      return db.getBankTransactionCoverage();
    }),
  }),

  dataCoverage: router({
    all: publicProcedure.query(async () => {
      return db.getDataCoverage();
    }),
  }),

  koomi: router({
    status: publicProcedure.query(async () => {
      return koomi.testConnection();
    }),
    syncSales: protectedProcedure.input(z.object({
      fromDate: z.string(),
      toDate: z.string(),
    })).mutation(async ({ input }) => {
      const records = await koomi.fetchNetOnsiteSales(input.fromDate, input.toDate);
      let inserted = 0;
      let updated = 0;
      for (const rec of records) {
        const result = await db.upsertDailySale({
          locationId: rec.locationId,
          saleDate: rec.saleDate,
          totalSales: rec.totalSales,
          taxableSales: rec.taxableSales,
          tipsCollected: rec.tipsCollected,
          orderCount: rec.orderCount,
          labourCost: rec.labourCost,
        });
        if (result === 'inserted') inserted++;
        else updated++;
      }
      // Update integration last sync time
      const dbConn = await db.getDb();
      if (dbConn) {
        const { integrations } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await dbConn.update(integrations)
          .set({ lastSyncAt: new Date(), status: 'live' })
          .where(eq(integrations.name, 'Koomi POS'));
      }
      return {
        success: true,
        recordsProcessed: records.length,
        inserted,
        updated,
        dateRange: { from: input.fromDate, to: input.toDate },
        stores: Array.from(new Set(records.map(r => r.locationId))).length,
      };
    }),
    syncBreakdown: protectedProcedure.input(z.object({
      fromDate: z.string(),
      toDate: z.string(),
    })).mutation(async ({ input }) => {
      const blocks = await koomi.fetchBreakdownOnsiteSales(input.fromDate, input.toDate);
      const rows = koomi.breakdownToProductSalesRows(blocks);
      const result = await db.importProductSales(rows);
      // Update integration last sync time
      const dbConn = await db.getDb();
      if (dbConn) {
        const { integrations } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await dbConn.update(integrations)
          .set({ lastSyncAt: new Date(), status: 'live' })
          .where(eq(integrations.name, 'Koomi POS'));
      }
      return {
        success: true,
        storesProcessed: blocks.length,
        totalItems: rows.length,
        ...result,
        dateRange: { from: input.fromDate, to: input.toDate },
      };
    }),
    schedulerStatus: publicProcedure.query(async () => {
      const status = koomiScheduler.getKoomiSchedulerStatus();
      const enabled = await autoRetry.getSetting("koomi_auto_sync_enabled");
      return { ...status, enabled: enabled === "true" };
    }),
    toggleScheduler: protectedProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ input }) => {
      await autoRetry.setSetting("koomi_auto_sync_enabled", input.enabled ? "true" : "false");
      if (input.enabled) {
        koomiScheduler.startKoomiScheduler();
      } else {
        koomiScheduler.stopKoomiScheduler();
      }
      return { success: true, enabled: input.enabled };
    }),
    syncNow: protectedProcedure.input(z.object({
      fromDate: z.string().optional(),
      toDate: z.string().optional(),
    }).optional()).mutation(async ({ input }) => {
      // Default: sync last 7 days to today
      const toDate = input?.toDate || koomi.getToday();
      const fromDate = input?.fromDate || (() => {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        return koomi.formatDate(d);
      })();
      return koomiScheduler.runKoomiSync(fromDate, toDate);
    }),
  }),
  // ─── CSV Data Export ───
  export: router({
    dailySales: publicProcedure.input(z.object({
      startDate: z.string(),
      endDate: z.string(),
      locationIds: z.array(z.number()).optional(),
    })).query(async ({ input }) => {
      const [sales, locations] = await Promise.all([
        db.getSalesRange(input.startDate, input.endDate),
        db.getAllLocations(),
      ]);
      const locMap = new Map(locations.map(l => [l.id, l.code]));
      const filtered = input.locationIds?.length
        ? sales.filter(s => input.locationIds!.includes(s.locationId))
        : sales;
      const csv = csvExport.dailySalesToCsv(filtered as any, locMap);
      return { csv, rowCount: filtered.length, filename: `daily_sales_${input.startDate}_to_${input.endDate}.csv` };
    }),
    payroll: publicProcedure.input(z.object({
      startDate: z.string(),
      endDate: z.string(),
      locationIds: z.array(z.number()).optional(),
    })).query(async ({ input }) => {
      const [payroll, locations] = await Promise.all([
        db.getPayrollRange(input.startDate, input.endDate),
        db.getAllLocations(),
      ]);
      const locMap = new Map(locations.map(l => [l.id, l.code]));
      const filtered = input.locationIds?.length
        ? payroll.filter(p => input.locationIds!.includes(p.locationId))
        : payroll;
      const csv = csvExport.payrollToCsv(filtered as any, locMap);
      return { csv, rowCount: filtered.length, filename: `payroll_${input.startDate}_to_${input.endDate}.csv` };
    }),
    productSales: publicProcedure.input(z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      locationId: z.number().optional(),
    })).query(async ({ input }) => {
      const [products, locations] = await Promise.all([
        db.getProductSalesSummary(input.locationId, input.startDate, input.endDate),
        db.getAllLocations(),
      ]);
      const locMap = new Map(locations.map(l => [l.id, l.code]));
      const csv = csvExport.productSalesToCsv(products as any, locMap);
      return { csv, rowCount: products.length, filename: `product_sales${input.locationId ? '_store' + input.locationId : ''}.csv` };
    }),
    combined: publicProcedure.input(z.object({
      startDate: z.string(),
      endDate: z.string(),
      locationIds: z.array(z.number()).optional(),
    })).query(async ({ input }) => {
      const [sales, locations] = await Promise.all([
        db.getSalesRange(input.startDate, input.endDate),
        db.getAllLocations(),
      ]);
      const locMap = new Map(locations.map(l => [l.id, l.code]));
      const locFoodCost = new Map(locations.map(l => [l.id, Number(l.foodCostTarget) / 100]));
      const filtered = input.locationIds?.length
        ? sales.filter(s => input.locationIds!.includes(s.locationId))
        : sales;
      const combined: csvExport.CombinedRow[] = filtered.map(s => {
        const rev = Number(s.totalSales);
        const labor = Number(s.labourCost || 0);
        const orders = s.orderCount || 0;
        const fcPct = locFoodCost.get(s.locationId) || 0.29;
        const cogs = rev * fcPct;
        const raw = s.saleDate;
        const dateStr = raw instanceof Date ? raw.toISOString().split('T')[0] : String(raw).slice(0, 10);
        return {
          date: dateStr,
          storeCode: locMap.get(s.locationId) || String(s.locationId),
          revenue: rev,
          laborCost: labor,
          laborPct: rev > 0 ? (labor / rev) * 100 : 0,
          orders,
          avgTicket: orders > 0 ? rev / orders : 0,
          grossProfit: rev - cogs,
          grossMarginPct: rev > 0 ? ((rev - cogs) / rev) * 100 : 0,
        };
      });
      const csv = csvExport.combinedSummaryToCsv(combined);
      return { csv, rowCount: combined.length, filename: `sales_labor_summary_${input.startDate}_to_${input.endDate}.csv` };
    }),
  }),

  // ─── Email Integration (Microsoft Graph) ───
  email: router({
    folders: protectedProcedure.query(async () => {
      try {
        const folders = await msgraph.listMailFolders();
        return { folders, error: null };
      } catch (err: any) {
        return { folders: [], error: err.message };
      }
    }),

    list: protectedProcedure.input(z.object({
      top: z.number().optional().default(25),
      skip: z.number().optional().default(0),
      folder: z.string().optional(),
      search: z.string().optional(),
      hasAttachments: z.boolean().optional(),
    }).optional()).query(async ({ input }) => {
      try {
        const top = input?.top ?? 25;
        const skip = input?.skip ?? 0;
        const folder = input?.folder;
        const search = input?.search;
        const filter = input?.hasAttachments ? "hasAttachments eq true" : undefined;
        const result = await msgraph.listEmails({ top, skip, folder, search, filter });
        return { ...result, error: null };
      } catch (err: any) {
        return { emails: [], totalCount: 0, error: err.message };
      }
    }),

    get: protectedProcedure.input(z.object({
      messageId: z.string(),
    })).query(async ({ input }) => {
      const email = await msgraph.getEmail(input.messageId);
      return email;
    }),

    attachments: protectedProcedure.input(z.object({
      messageId: z.string(),
    })).query(async ({ input }) => {
      const attachments = await msgraph.listAttachments(input.messageId);
      return attachments.map(a => ({
        id: a.id,
        name: a.name,
        contentType: a.contentType,
        size: a.size,
        isInline: a.isInline,
      }));
    }),

    downloadAttachment: protectedProcedure.input(z.object({
      messageId: z.string(),
      attachmentId: z.string(),
    })).mutation(async ({ input }) => {
      const { buffer, name, contentType } = await msgraph.downloadAttachment(input.messageId, input.attachmentId);
      // Upload to S3
      const { storagePut } = await import("./storage");
      const suffix = Math.random().toString(36).slice(2, 8);
      const fileKey = `email-attachments/${name.replace(/[^a-zA-Z0-9._-]/g, '_')}-${suffix}`;
      const { url } = await storagePut(fileKey, buffer, contentType);
      return { url, name, contentType, size: buffer.length };
    }),

    extractInvoice: protectedProcedure.input(z.object({
      messageId: z.string(),
      attachmentId: z.string(),
    })).mutation(async ({ input }) => {
      // Download the attachment
      const { buffer, name, contentType } = await msgraph.downloadAttachment(input.messageId, input.attachmentId);

      // Upload to S3
      const { storagePut } = await import("./storage");
      const suffix = Math.random().toString(36).slice(2, 8);
      const fileKey = `email-attachments/${name.replace(/[^a-zA-Z0-9._-]/g, '_')}-${suffix}`;
      const { url: fileUrl } = await storagePut(fileKey, buffer, contentType);

      // Use LLM to extract invoice details from the PDF
      const { invokeLLM } = await import("./_core/llm");
      const base64Content = buffer.toString("base64");
      const mimeType = contentType || "application/pdf";

      const llmResponse = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are an invoice data extraction assistant. Extract the following fields from the attached document. Return ONLY valid JSON with these fields:
- supplierName: string (the vendor/supplier name)
- invoiceNumber: string (invoice/bill number)
- invoiceDate: string (YYYY-MM-DD format)
- dueDate: string or null (YYYY-MM-DD format if found)
- totalAmount: number (total amount due)
- currency: string (CAD, USD, etc.)
- taxGST: number or null (GST/TPS amount if found)
- taxQST: number or null (QST/TVQ amount if found)
- lineItems: array of { description: string, quantity: number, unitPrice: number, amount: number }
- notes: string (any additional relevant info)

If a field cannot be determined, use null. Always return valid JSON.`,
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Extract invoice details from this document: ${name}` },
              { type: "file_url" as any, file_url: { url: `data:${mimeType};base64,${base64Content}`, mime_type: mimeType as any } },
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "invoice_extraction",
            strict: true,
            schema: {
              type: "object",
              properties: {
                supplierName: { type: "string" },
                invoiceNumber: { type: "string" },
                invoiceDate: { type: ["string", "null"] },
                dueDate: { type: ["string", "null"] },
                totalAmount: { type: "number" },
                currency: { type: "string" },
                taxGST: { type: ["number", "null"] },
                taxQST: { type: ["number", "null"] },
                lineItems: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      description: { type: "string" },
                      quantity: { type: "number" },
                      unitPrice: { type: "number" },
                      amount: { type: "number" },
                    },
                    required: ["description", "quantity", "unitPrice", "amount"],
                    additionalProperties: false,
                  },
                },
                notes: { type: ["string", "null"] },
              },
              required: ["supplierName", "invoiceNumber", "invoiceDate", "dueDate", "totalAmount", "currency", "taxGST", "taxQST", "lineItems", "notes"],
              additionalProperties: false,
            },
          },
        },
      });

      let extracted;
      try {
        const rawContent = String(llmResponse.choices[0].message.content || "{}");
        extracted = JSON.parse(rawContent);
      } catch {
        extracted = { error: "Failed to parse LLM response", raw: String(llmResponse.choices[0].message.content) };
      }

      // Get the email details for tracking
      const email = await msgraph.getEmail(input.messageId);

      // Save to processedEmails table
      await db.upsertProcessedEmail({
        messageId: input.messageId,
        subject: email.subject,
        senderName: email.from?.emailAddress?.name,
        senderEmail: email.from?.emailAddress?.address,
        receivedAt: new Date(email.receivedDateTime),
        hasAttachments: true,
        attachmentCount: 1,
        status: extracted.error ? "error" : "processed",
        extractedSupplier: extracted.supplierName,
        extractedAmount: extracted.totalAmount,
        extractedInvoiceNumber: extracted.invoiceNumber,
        extractedDate: extracted.invoiceDate,
        fileUrl,
        processedAt: new Date(),
      });

      return { extracted, fileUrl, fileName: name };
    }),

    markAsRead: protectedProcedure.input(z.object({
      messageId: z.string(),
    })).mutation(async ({ input }) => {
      await msgraph.markAsRead(input.messageId);
      return { success: true };
    }),

    createInvoiceFromEmail: protectedProcedure.input(z.object({
      processedEmailId: z.number(),
      locationId: z.number().optional(),
      overrideSupplier: z.string().optional(),
      overrideTotal: z.string().optional(),
    })).mutation(async ({ input }) => {
      // 1. Get the processed email record
      const database = await db.getDb();
      if (!database) throw new Error("Database not available");
      const { processedEmails: peTable, invoiceLineItems: iliTable } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const peRows = await database.select().from(peTable).where(eq(peTable.id, input.processedEmailId)).limit(1);
      const pe = peRows[0];
      if (!pe) throw new Error("Processed email not found");
      if (pe.linkedInvoiceId) throw new Error(`Already linked to invoice #${pe.linkedInvoiceId}`);

      // 2. Match supplier by name (fuzzy)
      const supplierName = input.overrideSupplier || pe.extractedSupplier || "Unknown";
      const allSuppliers = await db.getAllSuppliers();
      let matchedSupplier = allSuppliers.find(s => s.name.toLowerCase() === supplierName.toLowerCase());
      if (!matchedSupplier) {
        // Fuzzy: check if supplier name contains or is contained by any existing supplier
        matchedSupplier = allSuppliers.find(s =>
          s.name.toLowerCase().includes(supplierName.toLowerCase()) ||
          supplierName.toLowerCase().includes(s.name.toLowerCase())
        );
      }

      // 3. Create the invoice
      const total = input.overrideTotal || (pe.extractedAmount ? String(pe.extractedAmount) : "0.00");
      const invoiceId = await db.createInvoice({
        invoiceNumber: pe.extractedInvoiceNumber || undefined,
        supplierId: matchedSupplier?.id,
        locationId: input.locationId,
        invoiceDate: pe.extractedDate || undefined,
        total,
        status: "pending",
        notes: `Created from email: ${pe.subject || "(no subject)"}\nSender: ${pe.senderName || ""} <${pe.senderEmail || ""}>`,
      });

      if (!invoiceId) throw new Error("Failed to create invoice");

      // 4. If we have extracted line items in the email notes/data, parse and insert them
      // The extracted data is stored in the processedEmails notes or we need to re-parse
      // For now, we'll try to get the extracted data from the email extraction
      // The extractInvoice procedure stores extracted data but we need to retrieve it
      // We'll check if there's a stored extraction result
      try {
        // Try to get the full extraction by re-reading the processed email
        // The extraction data isn't stored as JSON in the DB, but we have key fields
        // If the email has a fileUrl, link it to the invoice
        if (pe.fileUrl) {
          await db.updateInvoiceFile(invoiceId, {
            fileUrl: pe.fileUrl,
            fileKey: pe.fileUrl,
          });
        }
      } catch (err) {
        console.warn("[CreateInvoiceFromEmail] Could not link file:", err);
      }

      // 5. Link the processed email to the invoice
      await database.update(peTable).set({
        linkedInvoiceId: invoiceId,
        status: "processed" as const,
      }).where(eq(peTable.id, input.processedEmailId));

      return {
        success: true,
        invoiceId,
        supplierMatched: !!matchedSupplier,
        supplierName: matchedSupplier?.name || supplierName,
        total,
      };
    }),

    createInvoiceFromExtraction: protectedProcedure.input(z.object({
      messageId: z.string(),
      supplierName: z.string(),
      invoiceNumber: z.string().optional(),
      invoiceDate: z.string().optional(),
      dueDate: z.string().optional(),
      totalAmount: z.number(),
      currency: z.string().optional(),
      taxGST: z.number().optional(),
      taxQST: z.number().optional(),
      lineItems: z.array(z.object({
        description: z.string(),
        quantity: z.number(),
        unitPrice: z.number(),
        amount: z.number(),
      })).optional(),
      locationId: z.number().optional(),
      notes: z.string().optional(),
    })).mutation(async ({ input }) => {
      const database = await db.getDb();
      if (!database) throw new Error("Database not available");
      const { processedEmails: peTable, invoiceLineItems: iliTable } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      // 1. Match supplier
      const allSuppliers = await db.getAllSuppliers();
      let matchedSupplier = allSuppliers.find(s => s.name.toLowerCase() === input.supplierName.toLowerCase());
      if (!matchedSupplier) {
        matchedSupplier = allSuppliers.find(s =>
          s.name.toLowerCase().includes(input.supplierName.toLowerCase()) ||
          input.supplierName.toLowerCase().includes(s.name.toLowerCase())
        );
      }

      // 2. Calculate subtotal from total - taxes
      const gst = input.taxGST || 0;
      const qst = input.taxQST || 0;
      const subtotal = input.totalAmount - gst - qst;

      // 3. Create invoice
      const invoiceId = await db.createInvoice({
        invoiceNumber: input.invoiceNumber || undefined,
        supplierId: matchedSupplier?.id,
        locationId: input.locationId,
        invoiceDate: input.invoiceDate || undefined,
        dueDate: input.dueDate || undefined,
        subtotal: subtotal.toFixed(2),
        gst: gst.toFixed(2),
        qst: qst.toFixed(2),
        total: input.totalAmount.toFixed(2),
        status: "pending",
        notes: input.notes || `Created from email extraction (${input.currency || "CAD"})`,
      });

      if (!invoiceId) throw new Error("Failed to create invoice");

      // 4. Insert line items
      if (input.lineItems && input.lineItems.length > 0) {
        for (const li of input.lineItems) {
          await database.insert(iliTable).values({
            invoiceId,
            description: li.description,
            quantity: String(li.quantity),
            unitPrice: String(li.unitPrice),
            amount: String(li.amount),
          } as any);
        }
      }

      // 5. Link processed email if exists
      const pe = await db.getProcessedEmailByMessageId(input.messageId);
      if (pe) {
        await database.update(peTable).set({
          linkedInvoiceId: invoiceId,
          status: "processed" as const,
        }).where(eq(peTable.messageId, input.messageId));

        // Link the file if available
        if (pe.fileUrl) {
          await db.updateInvoiceFile(invoiceId, {
            fileUrl: pe.fileUrl,
            fileKey: pe.fileUrl,
          });
        }
      }

      return {
        success: true,
        invoiceId,
        supplierMatched: !!matchedSupplier,
        supplierName: matchedSupplier?.name || input.supplierName,
        lineItemsCreated: input.lineItems?.length || 0,
      };
    }),

    processedEmails: protectedProcedure.input(z.object({
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }).optional()).query(async ({ input }) => {
      const opts = input || { limit: 50, offset: 0 };
      const emails = await db.getProcessedEmails(opts.limit, opts.offset);
      const stats = await db.getProcessedEmailStats();
      return { emails, stats };
    }),

    stats: protectedProcedure.query(async () => {
      return db.getProcessedEmailStats();
    }),
  }),

  // ─── Cost Pipeline ───
  costPipeline: router({
    // Run the full pipeline for a specific invoice
    runForInvoice: protectedProcedure.input(z.object({ invoiceId: z.number() })).mutation(async ({ input }) => {
      return costPipeline.runInvoiceCostPipeline(input.invoiceId);
    }),

    // Get matches for an invoice
    getMatches: protectedProcedure.input(z.object({ invoiceId: z.number() })).query(async ({ input }) => {
      return costPipeline.getInvoiceMatches(input.invoiceId);
    }),

    // Get unmatched line items needing review
    unmatchedItems: protectedProcedure.query(async () => {
      return costPipeline.getUnmatchedLineItems();
    }),

    // Confirm or reject a match
    updateMatch: protectedProcedure.input(z.object({
      matchId: z.number(),
      status: z.enum(["confirmed", "rejected"]),
      inventoryItemId: z.number().optional(),
    })).mutation(async ({ input, ctx }) => {
      await costPipeline.updateMatchStatus(
        input.matchId,
        input.status,
        input.inventoryItemId,
        ctx.user?.name || "admin"
      );
      // If confirmed with a new inventory item, re-run price update for that match
      if (input.status === "confirmed" && input.inventoryItemId) {
        const matches = await costPipeline.getInvoiceMatches(0); // we need the match details
        // Recalculate recipe costs after manual confirmation
        await costPipeline.recalculateAllRecipeCosts();
      }
      return { success: true };
    }),

    // Get price history for an inventory item
    priceHistory: protectedProcedure.input(z.object({
      inventoryItemId: z.number(),
      limit: z.number().optional().default(20),
    })).query(async ({ input }) => {
      return costPipeline.getIngredientPriceHistory(input.inventoryItemId, input.limit);
    }),

    // Get all recent price changes
    recentPriceChanges: protectedProcedure.input(z.object({
      limit: z.number().optional().default(50),
    }).optional()).query(async ({ input }) => {
      const { getDb } = await import("./db");
      const database = await getDb();
      if (!database) return [];
      const { ingredientPriceHistory, inventoryItems } = await import("../drizzle/schema");
      const { desc, eq } = await import("drizzle-orm");
      const changes = await database.select({
        id: ingredientPriceHistory.id,
        inventoryItemId: ingredientPriceHistory.inventoryItemId,
        invoiceId: ingredientPriceHistory.invoiceId,
        previousCostPerUnit: ingredientPriceHistory.previousCostPerUnit,
        newCostPerUnit: ingredientPriceHistory.newCostPerUnit,
        previousCostPerUsableUnit: ingredientPriceHistory.previousCostPerUsableUnit,
        newCostPerUsableUnit: ingredientPriceHistory.newCostPerUsableUnit,
        changePercent: ingredientPriceHistory.changePercent,
        quantity: ingredientPriceHistory.quantity,
        unit: ingredientPriceHistory.unit,
        source: ingredientPriceHistory.source,
        createdAt: ingredientPriceHistory.createdAt,
      }).from(ingredientPriceHistory)
        .orderBy(desc(ingredientPriceHistory.createdAt))
        .limit(input?.limit || 50);

      // Enrich with item names
      const allItems = await database.select({ id: inventoryItems.id, name: inventoryItems.name }).from(inventoryItems);
      const itemMap = new Map(allItems.map(i => [i.id, i.name]));
      return changes.map(c => ({
        ...c,
        itemName: itemMap.get(c.inventoryItemId) || "Unknown",
      }));
    }),

    // Get cost impact summary
    costImpact: protectedProcedure.query(async () => {
      return costPipeline.getCostImpactSummary();
    }),

    // Force recalculate all recipe costs
    recalculateAll: protectedProcedure.mutation(async () => {
      const updated = await costPipeline.recalculateAllRecipeCosts();
      return { updated };
    }),
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // FINANCIAL STATEMENTS MODULE
  // ═══════════════════════════════════════════════════════════════════════════

  financialStatements: router({
    // ─── QBO Entities ───
    entities: router({
      list: publicProcedure.query(async () => {
        let entities = await financialDb.getQboEntities();
        // Auto-create entities on first access if table is empty
        if (entities.length === 0) {
          try {
            const allLocations = await db.getAllLocations();
            const activeTokens = await qbo.getActiveTokens();
            const realmId = activeTokens?.realmId || "pending";
            const CAFE_LEGAL_MAP: Record<string, { legalName: string; companyName: string }> = {
              "PK": { legalName: "9427-0659 Quebec Inc", companyName: "PK Cafe" },
              "MK": { legalName: "9427-0659 Quebec Inc", companyName: "MK Cafe" },
              "ONT": { legalName: "9287-8982 Quebec Inc", companyName: "ONT Cafe" },
              "CT": { legalName: "9364-1009 Quebec Inc", companyName: "CT Cafe" },
              "FAC": { legalName: "Hinnawi Bros Bagel & Cafe", companyName: "Factory & Central Kitchen" },
              "FACTORY": { legalName: "Hinnawi Bros Bagel & Cafe", companyName: "Factory & Central Kitchen" },
            };
            for (const loc of allLocations) {
              const code = loc.code?.toUpperCase() || "";
              const mapping = CAFE_LEGAL_MAP[code];
              if (!mapping) continue;
              await financialDb.upsertQboEntity({
                locationId: loc.id,
                realmId,
                companyName: mapping.companyName,
                legalName: mapping.legalName,
                fiscalYearStartMonth: 9,
              });
            }
            await financialDb.seedDefaultLineDefinitions();
            entities = await financialDb.getQboEntities();
            console.log(`[FinancialStatements] Auto-created ${entities.length} entities`);
          } catch (err) {
            console.error("[FinancialStatements] Auto-setup failed:", err);
          }
        }
        return entities;
      }),
      get: publicProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
        return financialDb.getQboEntityById(input.id);
      }),
      upsert: protectedProcedure.input(z.object({
        locationId: z.number(),
        realmId: z.string(),
        companyName: z.string().optional(),
        legalName: z.string().optional(),
        fiscalYearStartMonth: z.number().optional(),
      })).mutation(async ({ input }) => {
        const id = await financialDb.upsertQboEntity(input);
        return { success: true, id };
      }),
      syncAccounts: protectedProcedure.input(z.object({ entityId: z.number() })).mutation(async ({ input }) => {
        const count = await qboReports.syncEntityAccounts(input.entityId);
        return { success: true, accountCount: count };
      }),
      accountCache: publicProcedure.input(z.object({ entityId: z.number() })).query(async ({ input }) => {
        return financialDb.getQboAccountCacheForEntity(input.entityId);
      }),
      /**
       * Auto-setup: creates QBO entities from existing locations + QBO tokens.
       * Uses the known cafe→company mapping from the spec.
       */
      autoSetup: protectedProcedure.mutation(async () => {
        const allLocations = await db.getAllLocations();
        const activeTokens = await qbo.getActiveTokens();
        const realmId = activeTokens?.realmId || "pending";

        // Known mapping: location code → legal name
        const CAFE_LEGAL_MAP: Record<string, { legalName: string; companyName: string }> = {
          "PK": { legalName: "9427-0659 Quebec Inc", companyName: "PK Cafe" },
          "MK": { legalName: "9427-0659 Quebec Inc", companyName: "MK Cafe" },
          "ONT": { legalName: "9287-8982 Quebec Inc", companyName: "ONT Cafe" },
          "CT": { legalName: "9364-1009 Quebec Inc", companyName: "CT Cafe" },
          "FAC": { legalName: "Hinnawi Bros Bagel & Cafe", companyName: "Factory & Central Kitchen" },
          "FACTORY": { legalName: "Hinnawi Bros Bagel & Cafe", companyName: "Factory & Central Kitchen" },
        };

        const created: Array<{ locationId: number; entityId: number; name: string }> = [];

        for (const loc of allLocations) {
          const code = loc.code?.toUpperCase() || "";
          const mapping = CAFE_LEGAL_MAP[code];
          if (!mapping) continue;

          const entityId = await financialDb.upsertQboEntity({
            locationId: loc.id,
            realmId,
            companyName: mapping.companyName,
            legalName: mapping.legalName,
            fiscalYearStartMonth: 9,
          });
          created.push({ locationId: loc.id, entityId, name: mapping.companyName });
        }

        // Also seed line definitions if not already done
        await financialDb.seedDefaultLineDefinitions();

        return { success: true, entitiesCreated: created.length, entities: created };
      }),
      seedLineDefinitions: protectedProcedure.mutation(async () => {
        await financialDb.seedDefaultLineDefinitions();
        return { success: true };
      }),
    }),

    // ─── Account Mappings ───
    mappings: router({
      getForEntity: publicProcedure.input(z.object({ entityId: z.number() })).query(async ({ input }) => {
        return financialDb.getMappingsForEntity(input.entityId);
      }),
      getActiveVersion: publicProcedure.input(z.object({ entityId: z.number() })).query(async ({ input }) => {
        return financialDb.getActiveMappingVersion(input.entityId);
      }),
      createVersion: protectedProcedure.input(z.object({
        qboEntityId: z.number(),
        label: z.string().optional(),
        effectiveFrom: z.string(),
      })).mutation(async ({ input, ctx }) => {
        const id = await financialDb.createMappingVersion({
          ...input,
          createdBy: ctx.user?.name || "Unknown",
        });
        return { success: true, id };
      }),
      upsert: protectedProcedure.input(z.object({
        versionId: z.number(),
        qboEntityId: z.number(),
        qboAccountId: z.string(),
        qboAccountName: z.string().optional(),
        statementType: z.enum(["profit_loss", "balance_sheet"]),
        category: z.string(),
        subcategory: z.string().optional(),
        customLabel: z.string().optional(),
        sortOrder: z.number().optional(),
        isHidden: z.boolean().optional(),
        flags: z.record(z.string(), z.unknown()).optional(),
      })).mutation(async ({ input, ctx }) => {
        const id = await financialDb.upsertMapping({
          ...input,
          changedBy: ctx.user?.name || "Unknown",
        });
        return { success: true, id };
      }),
      delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
        await financialDb.deleteMapping(input.id, ctx.user?.name || "Unknown");
        return { success: true };
      }),
      reorder: protectedProcedure.input(z.object({
        updates: z.array(z.object({ id: z.number(), sortOrder: z.number() })),
      })).mutation(async ({ input, ctx }) => {
        await financialDb.updateMappingSortOrder(input.updates, ctx.user?.name || "Unknown");
        return { success: true };
      }),
      auditTrail: publicProcedure.input(z.object({ entityId: z.number(), limit: z.number().optional() })).query(async ({ input }) => {
        return financialDb.getMappingAuditTrail(input.entityId, input.limit);
      }),
    }),

    // ─── Line Definitions ───
    lineDefinitions: router({
      get: publicProcedure.input(z.object({ statementType: z.enum(["profit_loss", "balance_sheet"]) })).query(async ({ input }) => {
        return financialDb.getFsLineDefinitions(input.statementType);
      }),
      seed: protectedProcedure.mutation(async () => {
        await financialDb.seedDefaultLineDefinitions();
        return { success: true };
      }),
    }),

    // ─── Reports ───
    reports: router({
      profitAndLoss: publicProcedure.input(z.object({
        entityId: z.number(),
        startDate: z.string(),
        endDate: z.string(),
        includeComparison: z.boolean().optional(),
        includeYoY: z.boolean().optional(),
        includeSharedExpenses: z.boolean().optional(),
        locationId: z.number().optional(),
      })).query(async ({ input }) => {
        return financialReports.buildProfitAndLoss({
          ...input,
          includeComparison: input.includeComparison ?? false,
          includeYoY: input.includeYoY ?? false,
          includeSharedExpenses: input.includeSharedExpenses ?? false,
        });
      }),
      balanceSheet: publicProcedure.input(z.object({
        entityId: z.number(),
        asOfDate: z.string(),
        compareDate: z.string().optional(),
        includeSharedExpenses: z.boolean().optional(),
      })).query(async ({ input }) => {
        return financialReports.buildBalanceSheet({
          ...input,
          includeSharedExpenses: input.includeSharedExpenses ?? false,
        });
      }),
      exportCsv: publicProcedure.input(z.object({
        entityId: z.number(),
        statementType: z.enum(["profit_loss", "balance_sheet"]),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        asOfDate: z.string().optional(),
        compareDate: z.string().optional(),
        includeComparison: z.boolean().optional(),
        includeYoY: z.boolean().optional(),
        includeSharedExpenses: z.boolean().optional(),
        locationId: z.number().optional(),
      })).query(async ({ input }) => {
        let statement;
        if (input.statementType === "profit_loss") {
          statement = await financialReports.buildProfitAndLoss({
            entityId: input.entityId,
            startDate: input.startDate!,
            endDate: input.endDate!,
            includeComparison: input.includeComparison ?? false,
            includeYoY: input.includeYoY ?? false,
            includeSharedExpenses: input.includeSharedExpenses ?? false,
            locationId: input.locationId,
          });
        } else {
          statement = await financialReports.buildBalanceSheet({
            entityId: input.entityId,
            asOfDate: input.asOfDate!,
            compareDate: input.compareDate,
            includeSharedExpenses: input.includeSharedExpenses ?? false,
          });
        }
        return { csv: financialExport.statementToCsv(statement), fileName: `${statement.entityName}_${input.statementType}_${new Date().toISOString().split("T")[0]}.csv` };
      }),
      exportHtml: publicProcedure.input(z.object({
        entityId: z.number(),
        statementType: z.enum(["profit_loss", "balance_sheet"]),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        asOfDate: z.string().optional(),
        compareDate: z.string().optional(),
        includeComparison: z.boolean().optional(),
        includeYoY: z.boolean().optional(),
        includeSharedExpenses: z.boolean().optional(),
        locationId: z.number().optional(),
      })).query(async ({ input }) => {
        let statement;
        if (input.statementType === "profit_loss") {
          statement = await financialReports.buildProfitAndLoss({
            entityId: input.entityId,
            startDate: input.startDate!,
            endDate: input.endDate!,
            includeComparison: input.includeComparison ?? false,
            includeYoY: input.includeYoY ?? false,
            includeSharedExpenses: input.includeSharedExpenses ?? false,
            locationId: input.locationId,
          });
        } else {
          statement = await financialReports.buildBalanceSheet({
            entityId: input.entityId,
            asOfDate: input.asOfDate!,
            compareDate: input.compareDate,
            includeSharedExpenses: input.includeSharedExpenses ?? false,
          });
        }
        return { html: financialExport.statementToHtml(statement), fileName: `${statement.entityName}_${input.statementType}_${new Date().toISOString().split("T")[0]}.html` };
      }),
      exportExcel: publicProcedure.input(z.object({
        entityId: z.number(),
        statementType: z.enum(["profit_loss", "balance_sheet"]),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        asOfDate: z.string().optional(),
        compareDate: z.string().optional(),
        includeComparison: z.boolean().optional(),
        includeYoY: z.boolean().optional(),
        includeSharedExpenses: z.boolean().optional(),
        locationId: z.number().optional(),
      })).query(async ({ input }) => {
        let statement;
        if (input.statementType === "profit_loss") {
          statement = await financialReports.buildProfitAndLoss({
            entityId: input.entityId,
            startDate: input.startDate!,
            endDate: input.endDate!,
            includeComparison: input.includeComparison ?? false,
            includeYoY: input.includeYoY ?? false,
            includeSharedExpenses: input.includeSharedExpenses ?? false,
            locationId: input.locationId,
          });
        } else {
          statement = await financialReports.buildBalanceSheet({
            entityId: input.entityId,
            asOfDate: input.asOfDate!,
            compareDate: input.compareDate,
            includeSharedExpenses: input.includeSharedExpenses ?? false,
          });
        }
        return { excel: financialExport.statementToExcelXml(statement), fileName: `${statement.entityName}_${input.statementType}_${new Date().toISOString().split("T")[0]}.xls` };
      }),
    }),

    // ─── Shared Expenses ───
    sharedExpenses: router({
      list: publicProcedure.input(z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        status: z.string().optional(),
        category: z.string().optional(),
      }).optional()).query(async ({ input }) => {
        return financialDb.getSharedExpenses(input || undefined);
      }),
      get: publicProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
        const expense = await financialDb.getSharedExpenseById(input.id);
        const allocations = await financialDb.getAllocationsForExpense(input.id);
        return { expense, allocations };
      }),
      create: protectedProcedure.input(z.object({
        expenseDate: z.string(),
        vendor: z.string().optional(),
        description: z.string().optional(),
        amount: z.string(),
        reportingPeriodStart: z.string().optional(),
        reportingPeriodEnd: z.string().optional(),
        expenseCategory: z.string().optional(),
        statementCategory: z.string().optional(),
        statementSubcategory: z.string().optional(),
        customLabel: z.string().optional(),
        allocationBasis: z.enum(["revenue", "fixed_pct", "equal", "manual", "payroll", "sqft"]).optional(),
        entitiesIncluded: z.array(z.number()).optional(),
        sourceType: z.enum(["manual", "credit_card", "journal_entry", "import"]).optional(),
        approvalStatus: z.enum(["draft", "approved", "posted"]).optional(),
        notes: z.string().optional(),
      })).mutation(async ({ input, ctx }) => {
        const id = await financialDb.createSharedExpense({
          ...input,
          createdBy: ctx.user?.name || "Unknown",
        });
        return { success: true, id };
      }),
      update: protectedProcedure.input(z.object({
        id: z.number(),
        expenseDate: z.string().optional(),
        vendor: z.string().optional(),
        description: z.string().optional(),
        amount: z.string().optional(),
        reportingPeriodStart: z.string().optional(),
        reportingPeriodEnd: z.string().optional(),
        expenseCategory: z.string().optional(),
        statementCategory: z.string().optional(),
        statementSubcategory: z.string().optional(),
        customLabel: z.string().optional(),
        allocationBasis: z.enum(["revenue", "fixed_pct", "equal", "manual", "payroll", "sqft"]).optional(),
        entitiesIncluded: z.array(z.number()).optional(),
        sourceType: z.enum(["manual", "credit_card", "journal_entry", "import"]).optional(),
        approvalStatus: z.enum(["draft", "approved", "posted"]).optional(),
        notes: z.string().optional(),
      })).mutation(async ({ input }) => {
        const { id, ...data } = input;
        await financialDb.updateSharedExpense(id, data);
        return { success: true };
      }),
      delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
        await financialDb.deleteSharedExpense(input.id);
        return { success: true };
      }),
      computeAllocation: protectedProcedure.input(z.object({
        sharedExpenseId: z.number(),
        periodStart: z.string(),
        periodEnd: z.string(),
        entityLocationIds: z.array(z.number()),
      })).mutation(async ({ input, ctx }) => {
        const allocations = await financialDb.computeRevenueAllocation(
          input.sharedExpenseId,
          input.periodStart,
          input.periodEnd,
          input.entityLocationIds,
          ctx.user?.name || "Unknown",
        );
        return { success: true, allocations };
      }),
      allocationsForExpense: publicProcedure.input(z.object({ sharedExpenseId: z.number() })).query(async ({ input }) => {
        return financialDb.getAllocationsForExpense(input.sharedExpenseId);
      }),
      allocationsForLocation: publicProcedure.input(z.object({
        locationId: z.number(),
        periodStart: z.string(),
        periodEnd: z.string(),
      })).query(async ({ input }) => {
        return financialDb.getAllocationsForLocation(input.locationId, input.periodStart, input.periodEnd);
      }),
      uploadFile: protectedProcedure.input(z.object({
        sharedExpenseId: z.number(),
        fileData: z.string(),
        fileName: z.string(),
        contentType: z.string(),
      })).mutation(async ({ input }) => {
        const { storagePut } = await import('./storage');
        const buffer = Buffer.from(input.fileData, 'base64');
        const suffix = Math.random().toString(36).substring(2, 8);
        const key = `shared-expenses/${input.sharedExpenseId}/${suffix}-${input.fileName}`;
        const { url } = await storagePut(key, buffer, input.contentType);
        await financialDb.updateSharedExpense(input.sharedExpenseId, { fileUrl: url, fileKey: key });
        return { success: true, url };
      }),
    }),
  }),
});
export type AppRouter = typeof appRouter;
