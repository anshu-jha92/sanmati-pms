import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLayout } from './layouts/AppLayout.jsx';
import { ProtectedRoute, RequirePerm } from './components/auth/Gates.jsx';

// Core pages
import { LoginPage } from './pages/LoginPage.jsx';
import { DashboardPage } from './pages/DashboardPage.jsx';

// Orders
import { SalesOrdersPage } from './pages/SalesOrdersPage.jsx';
import { PurchaseOrdersPage } from './pages/PurchaseOrdersPage.jsx';

// Production
import { PlanningOrdersPage } from './pages/PlanningOrdersPage.jsx';
import { ProductionFloorPage } from './pages/ProductionFloorPage.jsx';
import { OrderTrackingPage } from './pages/OrderTrackingPage.jsx';
import { MachinesPage } from './pages/MachinesPage.jsx';
import { MachineDetailPage } from './pages/MachineDetailPage.jsx';
import { DowntimePage } from './pages/DowntimePage.jsx';

// Quality
import { QCInspectionPage } from './pages/QCInspectionPage.jsx';

// Inventory
import { RawMaterialsPage } from './pages/RawMaterialsPage.jsx';
import { BOMPage } from './pages/BOMPage.jsx';

// Dispatch
import { DispatchingPage } from './pages/DispatchingPage.jsx';

// Operator simple UI
import { OperatorHomePage } from './pages/OperatorHomePage.jsx';

// Admin (keep your existing pages)
import { IntegrationsPage } from './pages/IntegrationsPage.jsx';
import { EmployeesPage } from './pages/EmployeesPage.jsx';
import { TeamsPage } from './pages/TeamsPage.jsx';
import { RolesPage } from './pages/RolesPage.jsx';
import { SettingsPage } from './pages/SettingsPage.jsx';
import { ReportsPage } from './pages/ReportsPage.jsx';
import { DepartmentsPage, DepartmentDetailPage } from './pages/DepartmentsPage.jsx';
import { OrgChartPage, OrgPersonPage } from './pages/OrgChartPage.jsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* Operator simple UI (separate layout) */}
          <Route path="/operator" element={<ProtectedRoute><OperatorHomePage /></ProtectedRoute>} />

          {/* Main admin layout */}
          <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
            <Route index element={<DashboardPage />} />

            {/* Orders */}
            <Route path="sales-orders"    element={<RequirePerm module="sales_orders"><SalesOrdersPage /></RequirePerm>} />
            <Route path="purchase-orders" element={<RequirePerm module="purchase_orders"><PurchaseOrdersPage /></RequirePerm>} />

            {/* Production */}
            <Route path="planning"         element={<RequirePerm module="production"><PlanningOrdersPage /></RequirePerm>} />
            <Route path="scheduling"       element={<Navigate to="/planning" replace />} />
            <Route path="production-floor" element={<RequirePerm module="production"><ProductionFloorPage /></RequirePerm>} />
            <Route path="orders"           element={<Navigate to="/planning" replace />} />
            <Route path="tracking"         element={<RequirePerm module="production"><OrderTrackingPage /></RequirePerm>} />
            <Route path="machines"         element={<RequirePerm module="machines"><MachinesPage /></RequirePerm>} />
            <Route path="machines/:id"     element={<RequirePerm module="machines"><MachineDetailPage /></RequirePerm>} />
            <Route path="downtime"         element={<RequirePerm module="machines"><DowntimePage /></RequirePerm>} />

            {/* Quality */}
            <Route path="qc" element={<RequirePerm module="qc"><QCInspectionPage /></RequirePerm>} />

            {/* Inventory */}
            <Route path="raw-materials"   element={<RequirePerm module="inventory"><RawMaterialsPage category="raw" /></RequirePerm>} />
            <Route path="finished-goods"  element={<RequirePerm module="inventory"><RawMaterialsPage category="finished_good" /></RequirePerm>} />
            <Route path="bom"             element={<BOMPage />} />
            <Route path="inventory"       element={<Navigate to="/raw-materials" replace />} />

            {/* Dispatch */}
            <Route path="dispatch" element={<RequirePerm module="dispatch"><DispatchingPage /></RequirePerm>} />

            {/* Reports */}
            <Route path="reports" element={<RequirePerm module="reports"><ReportsPage /></RequirePerm>} />

            {/* Admin */}
            <Route path="integrations" element={<RequirePerm module="integrations"><IntegrationsPage /></RequirePerm>} />
            <Route path="employees"    element={<RequirePerm module="employees"><EmployeesPage /></RequirePerm>} />
            <Route path="teams"        element={<RequirePerm module="teams"><TeamsPage /></RequirePerm>} />

            {/* Org structure — read-only views derived from employees + machines */}
            <Route path="org-chart"       element={<RequirePerm module="employees"><OrgChartPage /></RequirePerm>} />
            <Route path="org-chart/:id"   element={<RequirePerm module="employees"><OrgPersonPage /></RequirePerm>} />
            <Route path="departments"     element={<RequirePerm module="employees"><DepartmentsPage /></RequirePerm>} />
            <Route path="departments/:key" element={<RequirePerm module="employees"><DepartmentDetailPage /></RequirePerm>} />
            <Route path="roles"        element={<RequirePerm module="roles"><RolesPage /></RequirePerm>} />

            {/* Personal settings — available to every signed-in user */}
            <Route path="settings"     element={<SettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
