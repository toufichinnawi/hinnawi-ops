import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import Home from "./pages/Home";
import Invoices from "./pages/Invoices";
import Inventory from "./pages/Inventory";
import Purchasing from "./pages/Purchasing";
import Workforce from "./pages/Workforce";
import Reporting from "./pages/Reporting";
import Recipes from "./pages/Recipes";
import Integrations from "./pages/Integrations";
import DataImport from "./pages/DataImport";
import ProgressReport from "./pages/ProgressReport";
import MenuItems from "./pages/MenuItems";
import ProductSales from "./pages/ProductSales";
import CFODashboard from "./pages/CFODashboard";
import Quotations from "./pages/Quotations";
import ChartOfAccounts from "./pages/ChartOfAccounts";
import EmailInbox from "./pages/EmailInbox";
import CostPipeline from "./pages/CostPipeline";
import FinancialStatements from "./pages/FinancialStatements";

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/invoices" component={Invoices} />
        <Route path="/quotations" component={Quotations} />
        <Route path="/inventory" component={Inventory} />
        <Route path="/purchasing" component={Purchasing} />
        <Route path="/workforce" component={Workforce} />
        <Route path="/reports" component={Reporting} />
        <Route path="/recipes" component={Recipes} />
        <Route path="/data-import" component={DataImport} />
        <Route path="/progress" component={ProgressReport} />
        <Route path="/menu-items" component={MenuItems} />
        <Route path="/product-sales" component={ProductSales} />
        <Route path="/cfo" component={CFODashboard} />
        <Route path="/integrations" component={Integrations} />
        <Route path="/chart-of-accounts" component={ChartOfAccounts} />
        <Route path="/email" component={EmailInbox} />
        <Route path="/cost-pipeline" component={CostPipeline} />
        <Route path="/financial-statements" component={FinancialStatements} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
