import { useState, useEffect, useCallback } from 'react';
import { Users, Plus, X, Shield, Check, Ban, Save, Search, Mail, Phone, Eye, EyeOff, KeyRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';

type Role =
  | 'super_admin'
  | 'ops_manager'
  | 'front_desk'
  | 'foreman'
  | 'mechanic'
  | 'parts_admin'
  | 'finance'
  | 'fleet_admin'
  | 'driver'
  | 'customer';

type ApprovalStatus = 'pending' | 'approved' | 'rejected';

interface UserRecord {
  id: string;
  branch_id: string | null;
  full_name: string;
  email: string;
  role: Role;
  phone: string | null;
  is_active: boolean;
  approval_status: ApprovalStatus;
  avatar_url: string | null;
  created_at: string;
}

interface Branch {
  id: string;
  name: string;
  city: string;
}

const ROLE_COLORS: Record<Role, { bg: string; color: string }> = {
  super_admin: { bg: '#3B1F6B', color: '#C084FC' },
  ops_manager: { bg: '#1E3A5F', color: '#60A5FA' },
  front_desk: { bg: '#164E5A', color: '#22D3EE' },
  foreman: { bg: '#4A2500', color: '#F15A22' },
  mechanic: { bg: '#3D3000', color: '#FACC15' },
  parts_admin: { bg: '#14391F', color: '#4ADE80' },
  finance: { bg: '#1E1B4B', color: '#818CF8' },
  fleet_admin: { bg: '#0D3331', color: '#2DD4BF' },
  driver: { bg: '#2A2A2A', color: '#A0A0A0' },
  customer: { bg: '#3D1A2E', color: '#F472B6' },
};

const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  ops_manager: 'Ops Manager',
  front_desk: 'Front Desk',
  foreman: 'Foreman',
  mechanic: 'Mechanic',
  parts_admin: 'Parts Admin',
  finance: 'Finance',
  fleet_admin: 'Fleet Admin',
  driver: 'Driver',
  customer: 'Customer',
};

const ALL_ROLES: Role[] = [
  'super_admin',
  'ops_manager',
  'front_desk',
  'foreman',
  'mechanic',
  'parts_admin',
  'finance',
  'fleet_admin',
  'driver',
  'customer',
];

// Roles available to tenant admins — super_admin is platform-only
const TENANT_ROLES: Role[] = [
  'ops_manager',
  'front_desk',
  'foreman',
  'mechanic',
  'parts_admin',
  'finance',
  'fleet_admin',
  'driver',
  'customer',
];

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function AvatarCircle({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #F15A22, #FF8C42)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.35,
        fontWeight: 700,
        color: '#fff',
        flexShrink: 0,
        letterSpacing: '0.02em',
      }}
    >
      {getInitials(name)}
    </div>
  );
}

function RoleBadge({ role }: { role: Role }) {
  const colors = ROLE_COLORS[role];
  return (
    <span
      style={{
        background: colors.bg,
        color: colors.color,
        borderRadius: 4,
        padding: '2px 8px',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

interface InviteModalProps {
  branches: Branch[];
  onClose: () => void;
  onInvited: () => void;
}

function InviteModal({ branches, onClose, onInvited }: InviteModalProps) {
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    role: 'front_desk' as Role,
    branch_id: '',
    phone: '',
    temp_password: '',
  });
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!form.full_name.trim() || !form.email.trim()) {
      setError('Name and email are required.');
      return;
    }
    if (!form.temp_password.trim()) {
      setError('A temporary password is required.');
      return;
    }
    if (form.temp_password.length < 6) {
      setError('Temporary password must be at least 6 characters.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/users/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          email:         form.email.trim().toLowerCase(),
          full_name:     form.full_name.trim(),
          role:          form.role,
          branch_id:     form.branch_id || null,
          phone:         form.phone.trim() || null,
          temp_password: form.temp_password,
        }),
      });
      const json = await res.json();
      setSaving(false);
      if (!res.ok) { setError(json.error ?? 'Failed to invite user.'); return; }
      onInvited();
      onClose();
    } catch (e) {
      setSaving(false);
      setError('Could not reach server. Is the backend running?');
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 50,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          width: 420,
          background: '#161616',
          borderLeft: '1px solid #2A2A2A',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: 24,
          gap: 20,
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#F0F0F0', fontSize: 18, fontWeight: 700 }}>Invite User</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A0A0A0', padding: 4 }}
          >
            <X size={20} />
          </button>
        </div>

        <div
          style={{
            background: '#1E1E1E',
            border: '1px solid #2A2A2A',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 12,
            color: '#A0A0A0',
            lineHeight: 1.6,
          }}
        >
          Set a temporary password. The user will be asked to change it on their first login.
        </div>

        {error && (
          <div style={{ color: '#F87171', fontSize: 13, background: '#2A1515', borderRadius: 6, padding: '8px 12px' }}>
            {error}
          </div>
        )}

        {[
          { label: 'Full Name', key: 'full_name', type: 'text',  autoComplete: 'name', icon: <Users size={14} /> },
          { label: 'Email',     key: 'email',     type: 'email', autoComplete: 'off',  icon: <Mail size={14} /> },
          { label: 'Phone',     key: 'phone',     type: 'tel',   autoComplete: 'tel',  icon: <Phone size={14} /> },
        ].map(({ label, key, type, autoComplete, icon }) => (
          <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <label style={{ color: '#A0A0A0', fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
              {icon} {label}
            </label>
            <input
              type={type}
              autoComplete={autoComplete}
              value={(form as Record<string, string>)[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              style={{
                background: '#0E0E0E',
                border: '1px solid #2A2A2A',
                borderRadius: 6,
                padding: '8px 12px',
                color: '#F0F0F0',
                fontSize: 14,
                outline: 'none',
              }}
            />
          </div>
        ))}

        {/* Temporary password */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ color: '#A0A0A0', fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
            <KeyRound size={14} /> Temporary Password
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPass ? 'text' : 'password'}
              autoComplete="new-password"
              value={form.temp_password}
              onChange={(e) => setForm((f) => ({ ...f, temp_password: e.target.value }))}
              placeholder="Min. 6 characters"
              style={{
                width: '100%',
                background: '#0E0E0E',
                border: '1px solid #2A2A2A',
                borderRadius: 6,
                padding: '8px 36px 8px 12px',
                color: '#F0F0F0',
                fontSize: 14,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <button
              type="button"
              onClick={() => setShowPass((v) => !v)}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#A0A0A0', padding: 0 }}
            >
              {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <span style={{ fontSize: 11, color: '#6B7280' }}>User will be forced to change this on first login.</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ color: '#A0A0A0', fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Shield size={14} /> Role
          </label>
          <select
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}
            style={{
              background: '#0E0E0E',
              border: '1px solid #2A2A2A',
              borderRadius: 6,
              padding: '8px 12px',
              color: '#F0F0F0',
              fontSize: 14,
              outline: 'none',
            }}
          >
            {TENANT_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ color: '#A0A0A0', fontSize: 12, fontWeight: 500 }}>Branch</label>
          <select
            value={form.branch_id}
            onChange={(e) => setForm((f) => ({ ...f, branch_id: e.target.value }))}
            style={{
              background: '#0E0E0E',
              border: '1px solid #2A2A2A',
              borderRadius: 6,
              padding: '8px 12px',
              color: '#F0F0F0',
              fontSize: 14,
              outline: 'none',
            }}
          >
            <option value="">— No Branch —</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.city})
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handleSubmit}
          disabled={saving}
          style={{
            background: '#F15A22',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '12px 0',
            fontWeight: 700,
            fontSize: 14,
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.7 : 1,
            marginTop: 'auto',
          }}
        >
          {saving ? 'Creating...' : 'Create User'}
        </button>
      </div>
    </div>
  );
}

export function UsersPage() {
  const { user: currentUser } = useAuthStore();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'active' | 'inactive'>('all');
  const [filterRole, setFilterRole] = useState<Role | ''>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [loading, setLoading] = useState(true);

  const [editForm, setEditForm] = useState<Partial<UserRecord>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const isSuperAdmin = currentUser?.role === 'super_admin';

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('users').select('*').order('created_at', { ascending: false });
    if (!isSuperAdmin && currentUser?.branch_id) {
      query = query.eq('branch_id', currentUser.branch_id);
    }
    const { data } = await query;
    setUsers((data as UserRecord[]) ?? []);
    setLoading(false);
  }, [isSuperAdmin, currentUser?.branch_id]);

  const fetchBranches = useCallback(async () => {
    const { data } = await supabase.from('branches').select('id, name, city').order('name');
    setBranches((data as Branch[]) ?? []);
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchBranches();
  }, [fetchUsers, fetchBranches]);

  const selectedUser = users.find((u) => u.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedUser) {
      setEditForm({
        full_name: selectedUser.full_name,
        phone: selectedUser.phone ?? '',
        role: selectedUser.role,
        branch_id: selectedUser.branch_id ?? '',
      });
      setSaveError('');
    }
  }, [selectedId]);

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    if (q && !u.full_name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false;
    if (filterStatus === 'pending' && u.approval_status !== 'pending') return false;
    if (filterStatus === 'active' && (!u.is_active || u.approval_status !== 'approved')) return false;
    if (filterStatus === 'inactive' && u.is_active) return false;
    if (filterRole && u.role !== filterRole) return false;
    return true;
  });

  const branchName = (id: string | null) => {
    if (!id) return '—';
    return branches.find((b) => b.id === id)?.name ?? '—';
  };

  const handleToggleActive = async () => {
    if (!selectedUser) return;
    const newVal = !selectedUser.is_active;
    await supabase.from('users').update({ is_active: newVal }).eq('id', selectedUser.id);
    setUsers((prev) => prev.map((u) => (u.id === selectedUser.id ? { ...u, is_active: newVal } : u)));
  };

  const handleApproval = async (status: 'approved' | 'rejected') => {
    if (!selectedUser) return;
    await supabase.from('users').update({ approval_status: status, is_active: status === 'approved' }).eq('id', selectedUser.id);
    setUsers((prev) =>
      prev.map((u) => (u.id === selectedUser.id ? { ...u, approval_status: status, is_active: status === 'approved' } : u))
    );
  };

  const handleSave = async () => {
    if (!selectedUser) return;
    setSaving(true);
    setSaveError('');
    const { error } = await supabase
      .from('users')
      .update({
        full_name: editForm.full_name,
        phone: editForm.phone || null,
        role: editForm.role,
        branch_id: editForm.branch_id || null,
      })
      .eq('id', selectedUser.id);
    setSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setUsers((prev) =>
      prev.map((u) =>
        u.id === selectedUser.id
          ? {
              ...u,
              full_name: editForm.full_name ?? u.full_name,
              phone: editForm.phone ?? u.phone,
              role: (editForm.role as Role) ?? u.role,
              branch_id: editForm.branch_id ?? u.branch_id,
            }
          : u
      )
    );
  };

  const handleDeactivate = async () => {
    if (!selectedUser) return;
    await supabase.from('users').update({ is_active: false, approval_status: 'rejected' }).eq('id', selectedUser.id);
    setUsers((prev) =>
      prev.map((u) => (u.id === selectedUser.id ? { ...u, is_active: false, approval_status: 'rejected' } : u))
    );
  };

  const [resetPwModal, setResetPwModal] = useState(false);
  const [resetPw, setResetPw] = useState('');
  const [showResetPw, setShowResetPw] = useState(false);
  const [resetSaving, setResetSaving] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [resetError, setResetError] = useState('');

  const openResetModal = () => {
    setResetPw(''); setResetError(''); setResetDone(false); setShowResetPw(false); setResetPwModal(true);
  };

  const handleResetPassword = async () => {
    if (!selectedUser || resetPw.trim().length < 8) return;
    setResetSaving(true); setResetError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/users/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ user_id: selectedUser.id, new_password: resetPw.trim() }),
      });
      const json = await res.json();
      setResetSaving(false);
      if (!res.ok) { setResetError(json.error ?? 'Failed to reset password.'); return; }
      setResetDone(true);
    } catch {
      setResetSaving(false);
      setResetError('Could not reach server. Is the backend running?');
    }
  };

  const PILL_LABELS: { key: typeof filterStatus; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending Approval' },
    { key: 'active', label: 'Active' },
    { key: 'inactive', label: 'Inactive' },
  ];

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0E0E0E', color: '#F0F0F0', fontFamily: 'inherit', overflow: 'hidden' }}>
      <div
        style={{
          width: 380,
          flexShrink: 0,
          background: '#161616',
          borderRight: '1px solid #2A2A2A',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid #2A2A2A', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Users size={20} color="#F15A22" />
              <span style={{ fontSize: 18, fontWeight: 700 }}>Users</span>
              <span
                style={{
                  background: '#2A2A2A',
                  color: '#A0A0A0',
                  borderRadius: 12,
                  padding: '1px 8px',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {filtered.length}
              </span>
            </div>
            <button
              onClick={() => setShowInvite(true)}
              style={{
                background: '#F15A22',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '6px 12px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <Plus size={14} /> Invite User
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: '#0E0E0E',
              border: '1px solid #2A2A2A',
              borderRadius: 6,
              padding: '6px 10px',
            }}
          >
            <Search size={14} color="#A0A0A0" />
            <input
              placeholder="Search name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                background: 'none',
                border: 'none',
                outline: 'none',
                color: '#F0F0F0',
                fontSize: 13,
                flex: 1,
              }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A0A0A0', padding: 0 }}>
                <X size={12} />
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PILL_LABELS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilterStatus(key)}
                style={{
                  background: filterStatus === key ? '#F15A22' : '#0E0E0E',
                  color: filterStatus === key ? '#fff' : '#A0A0A0',
                  border: `1px solid ${filterStatus === key ? '#F15A22' : '#2A2A2A'}`,
                  borderRadius: 20,
                  padding: '3px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  letterSpacing: '0.02em',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value as Role | '')}
            style={{
              background: '#0E0E0E',
              border: '1px solid #2A2A2A',
              borderRadius: 6,
              padding: '6px 10px',
              color: filterRole ? '#F0F0F0' : '#A0A0A0',
              fontSize: 12,
              outline: 'none',
            }}
          >
            <option value="">All Roles</option>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#A0A0A0', fontSize: 13 }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#A0A0A0', fontSize: 13 }}>No users found.</div>
          ) : (
            filtered.map((u) => (
              <div
                key={u.id}
                onClick={() => setSelectedId(u.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  cursor: 'pointer',
                  borderBottom: '1px solid #1E1E1E',
                  background: selectedId === u.id ? '#1E1E1E' : 'transparent',
                  borderLeft: selectedId === u.id ? '3px solid #F15A22' : '3px solid transparent',
                  transition: 'background 0.1s',
                }}
              >
                <AvatarCircle name={u.full_name} size={38} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: '#F0F0F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {u.full_name}
                    </span>
                    {u.approval_status === 'pending' && (
                      <span
                        style={{
                          background: '#3D2800',
                          color: '#FACC15',
                          borderRadius: 4,
                          padding: '1px 6px',
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          flexShrink: 0,
                        }}
                      >
                        Pending
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: '#A0A0A0', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.email}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <RoleBadge role={u.role} />
                    <span style={{ fontSize: 11, color: '#A0A0A0' }}>{branchName(u.branch_id)}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selectedUser ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#A0A0A0',
              gap: 12,
            }}
          >
            <Users size={48} color="#2A2A2A" />
            <span style={{ fontSize: 14 }}>Select a user to view details</span>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: 32, display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
              <AvatarCircle name={selectedUser.full_name} size={72} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#F0F0F0', marginBottom: 4 }}>{selectedUser.full_name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#A0A0A0', marginBottom: 10 }}>
                  <Mail size={13} />
                  {selectedUser.email}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <RoleBadge role={selectedUser.role} />
                  <button
                    onClick={handleToggleActive}
                    style={{
                      background: selectedUser.is_active ? '#143D20' : '#2A2A2A',
                      color: selectedUser.is_active ? '#4ADE80' : '#A0A0A0',
                      border: `1px solid ${selectedUser.is_active ? '#4ADE80' : '#2A2A2A'}`,
                      borderRadius: 20,
                      padding: '3px 12px',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    {selectedUser.is_active ? <><Check size={11} /> Active</> : <><Ban size={11} /> Inactive</>}
                  </button>
                </div>
              </div>
            </div>

            {selectedUser.approval_status === 'pending' && (
              <div
                style={{
                  background: '#1E1A00',
                  border: '1px solid #3D3000',
                  borderRadius: 10,
                  padding: '16px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: '#FACC15', fontSize: 14, marginBottom: 4 }}>Pending Approval</div>
                  <div style={{ fontSize: 12, color: '#A0A0A0' }}>This user is waiting for account approval.</div>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={() => handleApproval('approved')}
                    style={{
                      background: '#143D20',
                      color: '#4ADE80',
                      border: '1px solid #4ADE80',
                      borderRadius: 6,
                      padding: '7px 16px',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Check size={14} /> Approve
                  </button>
                  <button
                    onClick={() => handleApproval('rejected')}
                    style={{
                      background: '#3D1515',
                      color: '#F87171',
                      border: '1px solid #F87171',
                      borderRadius: 6,
                      padding: '7px 16px',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <X size={14} /> Reject
                  </button>
                </div>
              </div>
            )}

            <div
              style={{
                background: '#161616',
                border: '1px solid #2A2A2A',
                borderRadius: 10,
                padding: '20px 24px',
                display: 'flex',
                flexDirection: 'column',
                gap: 18,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: '#A0A0A0', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Edit Details
              </div>

              {[
                { label: 'Full Name', key: 'full_name', type: 'text', icon: <Users size={13} /> },
                { label: 'Phone', key: 'phone', type: 'tel', icon: <Phone size={13} /> },
              ].map(({ label, key, type, icon }) => (
                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <label style={{ fontSize: 12, color: '#A0A0A0', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {icon} {label}
                  </label>
                  <input
                    type={type}
                    value={(editForm as Record<string, string>)[key] ?? ''}
                    onChange={(e) => setEditForm((f) => ({ ...f, [key]: e.target.value }))}
                    style={{
                      background: '#0E0E0E',
                      border: '1px solid #2A2A2A',
                      borderRadius: 6,
                      padding: '8px 12px',
                      color: '#F0F0F0',
                      fontSize: 14,
                      outline: 'none',
                    }}
                  />
                </div>
              ))}

              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <label style={{ fontSize: 12, color: '#A0A0A0', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Shield size={13} /> Role
                  </label>
                  <select
                    value={editForm.role ?? selectedUser.role}
                    onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as Role }))}
                    style={{
                      background: '#0E0E0E',
                      border: '1px solid #2A2A2A',
                      borderRadius: 6,
                      padding: '8px 12px',
                      color: '#F0F0F0',
                      fontSize: 14,
                      outline: 'none',
                    }}
                  >
                    {TENANT_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <label style={{ fontSize: 12, color: '#A0A0A0', fontWeight: 500 }}>Branch</label>
                  <select
                    value={editForm.branch_id ?? ''}
                    onChange={(e) => setEditForm((f) => ({ ...f, branch_id: e.target.value }))}
                    style={{
                      background: '#0E0E0E',
                      border: '1px solid #2A2A2A',
                      borderRadius: 6,
                      padding: '8px 12px',
                      color: '#F0F0F0',
                      fontSize: 14,
                      outline: 'none',
                    }}
                  >
                    <option value="">— No Branch —</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {saveError && (
                <div style={{ color: '#F87171', fontSize: 12, background: '#2A1515', borderRadius: 6, padding: '6px 10px' }}>
                  {saveError}
                </div>
              )}

              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  background: '#F15A22',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '10px 0',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.7 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <Save size={15} /> {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>

            <div
              style={{
                background: '#1A0E0E',
                border: '1px solid #3D1515',
                borderRadius: 10,
                padding: '16px 24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, color: '#F87171', fontSize: 14, marginBottom: 4 }}>Danger Zone</div>
                <div style={{ fontSize: 12, color: '#A0A0A0' }}>Deactivate and reject this user account.</div>
              </div>
              <button
                onClick={handleDeactivate}
                style={{
                  background: '#3D1515',
                  color: '#F87171',
                  border: '1px solid #F87171',
                  borderRadius: 6,
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Ban size={14} /> Deactivate Account
              </button>
            </div>

            {/* Reset Password */}
            <div
              style={{
                background: '#0E1A12',
                border: '1px solid #1A3D24',
                borderRadius: 10,
                padding: '16px 24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, color: '#4ADE80', fontSize: 14, marginBottom: 4 }}>Reset Password</div>
                <div style={{ fontSize: 12, color: '#A0A0A0' }}>Set a new temporary password. User must change it on next login.</div>
              </div>
              <button
                onClick={openResetModal}
                style={{
                  background: '#0D2B19',
                  color: '#4ADE80',
                  border: '1px solid #4ADE80',
                  borderRadius: 6,
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <KeyRound size={14} /> Reset Password
              </button>
            </div>
          </div>
        )}
      </div>

      {showInvite && (
        <InviteModal branches={branches} onClose={() => setShowInvite(false)} onInvited={fetchUsers} />
      )}

      {/* Reset Password Modal */}
      {resetPwModal && selectedUser && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 50, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={(e) => e.target === e.currentTarget && (setResetPwModal(false), setResetDone(false))}
        >
          <div style={{ backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, width: '100%', maxWidth: 420, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <p style={{ color: '#F0F0F0', fontWeight: 700, fontSize: 16, margin: 0 }}>Reset Password</p>
                <p style={{ color: '#A0A0A0', fontSize: 13, margin: '4px 0 0' }}>{selectedUser.full_name} · {selectedUser.email}</p>
              </div>
              <button onClick={() => { setResetPwModal(false); setResetDone(false); }} style={{ background: 'none', border: 'none', color: '#A0A0A0', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            {resetDone ? (
              <div>
                <div style={{ backgroundColor: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 10, padding: 16, marginBottom: 16, textAlign: 'center' }}>
                  <p style={{ color: '#4ADE80', fontWeight: 700, fontSize: 15, margin: '0 0 6px' }}>Password updated!</p>
                  <p style={{ color: '#A0A0A0', fontSize: 13, margin: 0 }}>
                    {selectedUser.full_name} can now log in with the new password.<br />
                    They will be prompted to change it on first login.
                  </p>
                </div>
                <button onClick={() => { setResetPwModal(false); setResetDone(false); }} style={{ width: '100%', padding: '9px 0', borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Done
                </button>
              </div>
            ) : (
              <div>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ color: '#A0A0A0', fontSize: 12, display: 'block', marginBottom: 6 }}>NEW TEMPORARY PASSWORD</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showResetPw ? 'text' : 'password'}
                      value={resetPw}
                      onChange={(e) => setResetPw(e.target.value)}
                      autoComplete="new-password"
                      placeholder="Min. 8 characters"
                      style={{ width: '100%', padding: '9px 40px 9px 12px', backgroundColor: '#0E0E0E', border: '1px solid #2A2A2A', borderRadius: 8, color: '#F0F0F0', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                    />
                    <button type="button" onClick={() => setShowResetPw(v => !v)}
                      style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#A0A0A0', cursor: 'pointer', padding: 0 }}>
                      {showResetPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <p style={{ color: '#A0A0A0', fontSize: 11, margin: '6px 0 0' }}>User will be forced to change this on first login.</p>
                </div>

                {resetError && (
                  <p style={{ color: '#FCA5A5', fontSize: 13, margin: '0 0 12px' }}>{resetError}</p>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setResetPwModal(false)} style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid #2A2A2A', backgroundColor: 'transparent', color: '#A0A0A0', fontSize: 13, cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button
                    onClick={handleResetPassword}
                    disabled={resetSaving || resetPw.trim().length < 8}
                    style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', fontSize: 13, fontWeight: 600, cursor: (resetSaving || resetPw.trim().length < 8) ? 'not-allowed' : 'pointer', opacity: (resetSaving || resetPw.trim().length < 8) ? 0.6 : 1 }}
                  >
                    {resetSaving ? 'Saving…' : 'Set Password'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
