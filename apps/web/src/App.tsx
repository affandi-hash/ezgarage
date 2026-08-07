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
import { PlatformSettingsPage } from '@/pages/PlatformSettingsPage'
import { UsersPage } from '@/pages/UsersPage'
import { SignUpPage } from '@/pages/SignUpPage'
import { OnboardingPage } from '@/pages/OnboardingPage'
import { CustomerPortalPage } from '@/pages/CustomerPortalPage'
import { OnlineBookingPage } from '@/pages/OnlineBookingPage'
import { QuotationsPage } from '@/pages/QuotationsPage'
import { LabourChargesPage } from '@/pages/LabourChargesPage'
import { ReceiptsPage } from '@/pages/ReceiptsPage'
import { FinancePage } from '@/pages/FinancePage'
import { ARPage } from '@/pages/ARPage'
import { ExpensesPage } from '@/pages/ExpensesPage'
import { ChangePasswordPage } from '@/pages/ChangePasswordPage'
import { PrintInvoicePage } from '@/pages/PrintInvoicePage'
import { PrintReceiptPage } from '@/pages/PrintReceiptPage'
import { EspRegistrationPage } from '@/pages/EspRegistrationPage'
import { EspCommunityPickerPage } from '@/pages/EspCommunityPickerPage'
import { EspMemberLoginPage } from '@/pages/EspMemberLoginPage'
import { EspCommunitySettingsPage } from '@/pages/EspCommunitySettingsPage'
import { EspMembersPage } from '@/pages/EspMembersPage'
import { EspAnnouncementsPage } from '@/pages/EspAnnouncementsPage'
import { EspReportsPage } from '@/pages/EspReportsPage'
import { PaymentVerificationsPage } from '@/pages/PaymentVerificationsPage'
import { BusinessProfilePage, MarketingPlanPage, SocialMediaEngagementPage, CampaignsPromotionsPage, SalesMarketingAnalyticsPage, AskYourCsmoPage } from '@/pages/SalesMarketingPages'

export default function App() {
  const { setUser, setTenant, setLoading } = useAuthStore()

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const { data: profile } = await supabase
          .from('users')
          .select('id, full_name, email, role, branch_id, approval_status, is_active, tenant_id, must_change_password, is_platform_admin')
          .eq('id', session.user.id)
          .single()
        setUser(profile ?? null)
        // authStore.signIn() already sets tenant on an interactive login,
        // but that never runs again on a restored session (every page
        // reload, every new tab) -- tenant silently stayed null forever
        // after the first login, breaking every page keyed off
        // tenant?.slug (ESP Communities' copy-link buttons, Settings,
        // Fleet, Inventory, Onboarding) until the user explicitly logged
        // out and back in.
        if (profile?.tenant_id) {
          const { data: tenant } = await supabase.from('tenants').select('*').eq('id', profile.tenant_id).single()
          setTenant(tenant ?? null)
        }
      }
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        setUser(null)
        setTenant(null)
        setLoading(false)
      } else if (event === 'SIGNED_IN' && session?.user) {
        const { data: profile } = await supabase
          .from('users')
          .select('id, full_name, email, role, branch_id, approval_status, is_active, tenant_id, must_change_password, is_platform_admin')
          .eq('id', session.user.id)
          .single()
        setUser(profile ?? null)
        if (profile?.tenant_id) {
          const { data: tenant } = await supabase.from('tenants').select('*').eq('id', profile.tenant_id).single()
          setTenant(tenant ?? null)
        }
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
        <Route path="/portal/:tenantSlug" element={<CustomerPortalPage />} />
        <Route path="/book" element={<OnlineBookingPage />} />
        <Route path="/book/:tenantSlug" element={<OnlineBookingPage />} />
        {/* No bare /esp route at all -- a community slug is always required,
            never an ambiguous fallback (same bug class 099 fixed for the
            customer portal's tenant resolution). /esp/join/:tenantSlug is a
            distinct 3-segment path (not /esp/communities/:tenantSlug) so it
            never collides with the existing protected staff route at
            /esp/communities. */}
        <Route path="/esp/join/:tenantSlug" element={<EspCommunityPickerPage />} />
        <Route path="/esp/login/:tenantSlug" element={<EspMemberLoginPage />} />
        <Route path="/esp/:communitySlug" element={<EspRegistrationPage />} />
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

          {/* Payment Verifications */}
          <Route
            path="/payment-verifications"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager','front_desk','finance','foreman']}>
                <PaymentVerificationsPage />
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

          {/* ESP Program */}
          <Route
            path="/esp/communities"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager','foreman']}>
                <EspCommunitySettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/esp/members"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager','front_desk','foreman']}>
                <EspMembersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/esp/reports"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager','finance','foreman']}>
                <EspReportsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/esp/announcements"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager','front_desk','foreman']}>
                <EspAnnouncementsPage />
              </ProtectedRoute>
            }
          />

          {/* Sales & Marketing */}
          <Route
            path="/sales-marketing/profile"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager']}>
                <BusinessProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/sales-marketing/plan"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager']}>
                <MarketingPlanPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/sales-marketing/social"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager']}>
                <SocialMediaEngagementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/sales-marketing/campaigns"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager']}>
                <CampaignsPromotionsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/sales-marketing/analytics"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager']}>
                <SalesMarketingAnalyticsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/sales-marketing/assistant"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager']}>
                <AskYourCsmoPage />
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
          {/* Platform Settings — cross-tenant, platform-operator only. Gated
              by is_platform_admin, completely independent of tenant role. */}
          <Route
            path="/platform-settings"
            element={
              <ProtectedRoute requirePlatformAdmin>
                <PlatformSettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/expenses"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager','finance','foreman']}>
                <ExpensesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/ar"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager','finance','foreman']}>
                <ARPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/finance"
            element={
              <ProtectedRoute allowedRoles={['super_admin','ops_manager','finance','foreman']}>
                <FinancePage />
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
