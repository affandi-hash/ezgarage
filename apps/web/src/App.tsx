import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import { ToastContainer } from '@/components/ui/Toast'
import { LoginPage } from '@/pages/LoginPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { CustomersPage } from '@/pages/CustomersPage'
import { VehiclesPage } from '@/pages/VehiclesPage'
import { BookingsPage } from '@/pages/BookingsPage'
import { WorkshopBoardPage } from '@/pages/WorkshopBoardPage'
import { PartsPage } from '@/pages/PartsPage'
import { InventoryPage } from '@/pages/InventoryPage'
import { StaffPage } from '@/pages/StaffPage'
import { AttendancePage } from '@/pages/AttendancePage'
import { SettingsPage } from '@/pages/SettingsPage'
import { InvoicesPage } from '@/pages/InvoicesPage'
import { ReportsPage } from '@/pages/ReportsPage'
import { FleetPage } from '@/pages/FleetPage'
import { AuditLogPage } from '@/pages/AuditLogPage'
import { UsersPage } from '@/pages/UsersPage'
import { SignUpPage } from '@/pages/SignUpPage'
import { OnboardingPage } from '@/pages/OnboardingPage'
import { CustomerPortalPage } from '@/pages/CustomerPortalPage'
import { OnlineBookingPage } from '@/pages/OnlineBookingPage'
import { QuotationsPage } from '@/pages/QuotationsPage'
import { LabourChargesPage } from '@/pages/LabourChargesPage'
import { ReceiptsPage } from '@/pages/ReceiptsPage'
import { ChangePasswordPage } from '@/pages/ChangePasswordPage'
import { PrintInvoicePage } from '@/pages/PrintInvoicePage'
import { PrintReceiptPage } from '@/pages/PrintReceiptPage'

export default function App() {
  const { setUser, setLoading } = useAuthStore()

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const { data: profile } = await supabase
          .from('users')
          .select('id, full_name, email, role, branch_id, approval_status, is_active, tenant_id, must_change_password')
          .eq('id', session.user.id)
          .single()
        setUser(profile ?? null)
      }
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        setUser(null)
        setLoading(false)
      } else if (event === 'SIGNED_IN' && session?.user) {
        const { data: profile } = await supabase
          .from('users')
          .select('id, full_name, email, role, branch_id, approval_status, is_active, tenant_id, must_change_password')
          .eq('id', session.user.id)
          .single()
        setUser(profile ?? null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/portal" element={<CustomerPortalPage />} />
        <Route path="/book" element={<OnlineBookingPage />} />
        <Route path="/print/invoice/:id" element={<ProtectedRoute><PrintInvoicePage /></ProtectedRoute>} />
        <Route path="/print/receipt/:id" element={<ProtectedRoute><PrintReceiptPage /></ProtectedRoute>} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          {/* Dashboard - all active staff */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager','front_desk','foreman','mechanic','parts_admin','finance','fleet_admin','driver']}>
                <DashboardPage />
              </ProtectedRoute>
            }
          />

          {/* Workshop Board */}
          <Route
            path="/workshop"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager','front_desk','foreman','mechanic']}>
                <WorkshopBoardPage />
              </ProtectedRoute>
            }
          />

          {/* Bookings */}
          <Route
            path="/bookings"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager','front_desk','foreman']}>
                <BookingsPage />
              </ProtectedRoute>
            }
          />

          {/* Customers */}
          <Route
            path="/customers"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager','front_desk','foreman']}>
                <CustomersPage />
              </ProtectedRoute>
            }
          />

          {/* Vehicles */}
          <Route
            path="/vehicles"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager','front_desk','foreman']}>
                <VehiclesPage />
              </ProtectedRoute>
            }
          />

          {/* Parts */}
          <Route
            path="/parts"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager','foreman','mechanic','parts_admin']}>
                <PartsPage />
              </ProtectedRoute>
            }
          />

          {/* Inventory */}
          <Route
            path="/inventory"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager','parts_admin','foreman']}>
                <InventoryPage />
              </ProtectedRoute>
            }
          />

          {/* Invoices */}
          <Route
            path="/invoices"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager','front_desk','finance','foreman']}>
                <InvoicesPage />
              </ProtectedRoute>
            }
          />

          {/* Receipts */}
          <Route
            path="/receipts"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager','finance','foreman']}>
                <ReceiptsPage />
              </ProtectedRoute>
            }
          />

          {/* Labour Charges */}
          <Route
            path="/labour-charges"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager','foreman']}>
                <LabourChargesPage />
              </ProtectedRoute>
            }
          />

          {/* Staff */}
          <Route
            path="/staff"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager']}>
                <StaffPage />
              </ProtectedRoute>
            }
          />

          {/* Attendance */}
          <Route
            path="/attendance"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager','foreman','mechanic','front_desk','parts_admin','finance','fleet_admin','hr_manager']}>
                <AttendancePage />
              </ProtectedRoute>
            }
          />

          {/* Fleet */}
          <Route
            path="/fleet"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager','fleet_admin','driver']}>
                <FleetPage />
              </ProtectedRoute>
            }
          />

          {/* Reports */}
          <Route
            path="/reports"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager','finance','foreman']}>
                <ReportsPage />
              </ProtectedRoute>
            }
          />

          {/* Users */}
          <Route
            path="/users"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager']}>
                <UsersPage />
              </ProtectedRoute>
            }
          />

          {/* Settings */}
          <Route
            path="/settings"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager']}>
                <SettingsPage />
              </ProtectedRoute>
            }
          />

          {/* Quotations */}
          <Route
            path="/quotations"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager','front_desk','foreman']}>
                <QuotationsPage />
              </ProtectedRoute>
            }
          />

          {/* Audit Log */}
          <Route
            path="/audit"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager']}>
                <AuditLogPage />
              </ProtectedRoute>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>

      <ToastContainer />
    </BrowserRouter>
  )
}
