import { useState, useEffect, useCallback } from 'react';
import { Car, Truck, MapPin, AlertTriangle, Wrench, Plus, X, Fuel, FlagOff, Trash2, CalendarClock, ChevronRight, CheckCircle2, Clock, FileText, Upload, BellRing, Droplets } from 'lucide-react';
import { DatePickerInput } from '@/components/ui/DateTimePickers';
import { toast } from '@/components/ui/Toast';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';
import { logAudit } from '@/lib/audit';
import { formatName, formatPlate, formatTitleCase } from '@/lib/formatters';

const C = {
  bg: '#0E0E0E',
  surface: '#161616',
  border: '#2A2A2A',
  orange: '#F15A22',
  textPrimary: '#F0F0F0',
  textSecondary: '#A0A0A0',
};

type VehicleStatus = 'available' | 'in_use' | 'maintenance' | 'retired';
// fleet_trips has no status column â€” trips are tracked by start_time/end_time presence
type IssueSeverity = 'low' | 'medium' | 'high' | 'critical';
type IssueStatus = 'open' | 'in_progress' | 'resolved';

interface FleetVehicle {
  id: string;
  branch_id: string;
  vehicle_id: string;
  plate_number: string;
  brand: string;
  model: string;
  year: number;
  color: string;
  vehicle_type: 'car' | 'van' | 'motorcycle' | 'truck';
  fuel_type: string;
  current_mileage: number;
  status: VehicleStatus;
  assigned_driver_id: string | null;
  insurance_expiry: string | null;
  road_tax_expiry: string | null;
  notes: string | null;
}

interface FleetTrip {
  id: string;
  branch_id: string;
  fleet_vehicle_id: string;
  driver_id: string;
  driver_name: string | null;
  purpose: string;
  start_time: string;
  end_time: string | null;
  start_mileage: number;
  end_mileage: number | null;
  distance_km: number | null;
  fleet_vehicles?: { plate_number: string; brand: string; model: string };
}

interface FleetIssue {
  id: string;
  branch_id: string;
  fleet_vehicle_id: string;
  reported_by: string;
  issue_type: string;
  description: string;
  severity: IssueSeverity;
  status: IssueStatus;
  reported_at: string;
  resolved_at: string | null;
  fleet_vehicles?: { plate_number: string; brand: string; model: string };
}

interface FleetMaintenance {
  id: string;
  branch_id: string;
  fleet_vehicle_id: string;
  service_date: string;
  service_mileage: number | null;
  service_type: string;
  workshop_vendor: string | null;
  parts_changed: string | null;
  labour_cost: number;
  parts_cost: number;
  total_cost: number;
  next_service_date: string | null;
  next_service_mileage: number | null;
  invoice_url: string | null;
  remarks: string | null;
  created_at: string;
  fleet_vehicles?: { plate_number: string; brand: string; model: string };
}

function vehicleStatusColor(status: VehicleStatus): string {
  switch (status) {
    case 'available': return '#22C55E';
    case 'in_use': return '#3B82F6';
    case 'maintenance': return '#F15A22';
    case 'retired': return '#6B7280';
  }
}


function severityColor(severity: IssueSeverity): string {
  switch (severity) {
    case 'critical': return '#EF4444';
    case 'high': return '#F15A22';
    case 'medium': return '#EAB308';
    case 'low': return '#6B7280';
  }
}

function issueStatusColor(status: IssueStatus): string {
  switch (status) {
    case 'open': return '#EF4444';
    case 'in_progress': return '#F15A22';
    case 'resolved': return '#22C55E';
  }
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 600,
      background: color + '22',
      color,
      border: `1px solid ${color}44`,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    }}>
      {label}
    </span>
  );
}

>
      {label}
    </button>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        width: 520,
        maxWidth: '95vw',
        maxHeight: '85vh',
        overflowY: 'auto',
        padding: 24,
        position: 'relative',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary }}>{title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textSecondary }}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 12, color: C.textSecondary, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  color: C.textPrimary,
  padding: '8px 12px',
  fontSize: 14,
  boxSizing: 'border-box',
  outline: 'none',
};

const selectStyle: React.CSSProperties = { ...inputStyle };

function AddVehicleForm({ branchId, onSuccess, onClose }: { branchId: string; onSuccess: () => void; onClose: () => void }) {
  const { user } = useAuthStore();
  const [form, setForm] = useState({
    plate_number: '', brand: '', model: '', year: new Date().getFullYear(),
    color: '', vehicle_type: 'car', fuel_type: 'petrol',
    current_mileage: 0, status: 'available', notes: '',
    insurance_expiry: '', road_tax_expiry: '',
  });
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    // resolve branch_id: prefer prop, fall back to staff_profiles
    let resolvedBranchId = branchId
    if (!resolvedBranchId && user?.id) {
      const { data: sp } = await supabase.from('staff_profiles').select('branch_id').eq('user_id', user.id).single()
      resolvedBranchId = sp?.branch_id || ''
    }
    if (!resolvedBranchId) { toast('Branch not found for your account. Contact admin.', 'error'); setSaving(false); return; }

    // auto-generate vehicle_id from plate number
    const vehicleId = `VEH-${form.plate_number.replace(/\s+/g, '').toUpperCase()}`
    const { error } = await supabase.from('fleet_vehicles').insert({
      vehicle_id: vehicleId,
      plate_number: form.plate_number,
      brand: form.brand,
      model: form.model,
      year: Number(form.year),
      color: form.color,
      vehicle_type: form.vehicle_type,
      fuel_type: form.fuel_type,
      current_mileage: Number(form.current_mileage),
      status: form.status,
      notes: form.notes || null,
      insurance_expiry: form.insurance_expiry || null,
      road_tax_expiry: form.road_tax_expiry || null,
      branch_id: resolvedBranchId,
      tenant_id: user?.tenant_id,
    });
    setSaving(false);
    if (error) { toast(error.message, 'error'); return; }
    logAudit({ action: 'Vehicle Added', module: 'Fleet', record_type: 'fleet_vehicle', details: { plate: form.plate_number, brand: form.brand, model: form.model }, branch_id: resolvedBranchId, user_id: user?.id, tenant_id: user?.tenant_id });
    toast('Vehicle added', 'success');
    onSuccess();
    onClose();
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FormField label="Plate Number">
          <input style={inputStyle} value={form.plate_number} onChange={e => set('plate_number', e.target.value)} onBlur={e => set('plate_number', formatPlate(e.target.value))} required />
        </FormField>
        <FormField label="Vehicle Type">
          <select style={selectStyle} value={form.vehicle_type} onChange={e => set('vehicle_type', e.target.value)}>
            <option value="car">Car</option>
            <option value="van">Van</option>
            <option value="motorcycle">Motorcycle</option>
            <option value="truck">Truck</option>
          </select>
        </FormField>
        <FormField label="Brand / Make">
          <input style={inputStyle} value={form.brand} onChange={e => set('brand', e.target.value)} onBlur={e => set('brand', formatTitleCase(e.target.value))} required />
        </FormField>
        <FormField label="Model">
          <input style={inputStyle} value={form.model} onChange={e => set('model', e.target.value)} onBlur={e => set('model', formatTitleCase(e.target.value))} required />
        </FormField>
        <FormField label="Year">
          <input style={inputStyle} type="number" value={form.year} onChange={e => set('year', e.target.value)} required />
        </FormField>
        <FormField label="Color">
          <input style={inputStyle} value={form.color} onChange={e => set('color', e.target.value)} />
        </FormField>
        <FormField label="Fuel Type">
          <select style={selectStyle} value={form.fuel_type} onChange={e => set('fuel_type', e.target.value)}>
            <option value="petrol">Petrol</option>
            <option value="diesel">Diesel</option>
            <option value="electric">Electric</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </FormField>
        <FormField label="Current Mileage (km)">
          <input style={inputStyle} type="number" value={form.current_mileage} onChange={e => set('current_mileage', e.target.value)} />
        </FormField>
        <FormField label="Insurance Expiry">
          <DatePickerInput value={form.insurance_expiry} onChange={v => set('insurance_expiry', v)} placeholder="DD/MM/YYYY" style={inputStyle} />
        </FormField>
        <FormField label="Road Tax Expiry">
          <DatePickerInput value={form.road_tax_expiry} onChange={v => set('road_tax_expiry', v)} placeholder="DD/MM/YYYY" style={inputStyle} />
        </FormField>
      </div>
      <FormField label="Status">
        <select style={selectStyle} value={form.status} onChange={e => set('status', e.target.value)}>
          <option value="available">Available</option>
          <option value="in_use">In Use</option>
          <option value="maintenance">Maintenance</option>
          <option value="retired">Retired</option>
        </select>
      </FormField>
      <FormField label="Notes">
        <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }} value={form.notes} onChange={e => set('notes', e.target.value)} />
      </FormField>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
        <button type="button" onClick={onClose} style={{
          background: 'none', border: `1px solid ${C.border}`, borderRadius: 6,
          color: C.textSecondary, padding: '0 20px', minHeight: 44, cursor: 'pointer', fontSize: 14,
        }}>Cancel</button>
        <button type="submit" disabled={saving} style={{
          background: C.orange, border: 'none', borderRadius: 6,
          color: '#fff', padding: '0 24px', minHeight: 44, cursor: 'pointer', fontSize: 14, fontWeight: 700,
        }}>{saving ? 'Saving...' : 'Add Vehicle'}</button>
      </div>
    </form>
  );
}

function VehiclesTab({ branchFilter, isSuperAdmin }: { branchFilter: string | null; isSuperAdmin: boolean }) {
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const { user } = useAuthStore();

  async function load() {
    setLoading(true);
    let q = supabase.from('fleet_vehicles').select('*').order('created_at', { ascending: false });
    if (!isSuperAdmin && branchFilter) q = q.eq('branch_id', branchFilter);
    const { data } = await q;
    setVehicles(data || []);
    setLoading(false);
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this vehicle?')) return;
    const { error } = await supabase.from('fleet_vehicles').delete().eq('id', id);
    if (!error) {
      setVehicles(prev => prev.filter(v => v.id !== id));
    } else {
      toast(error.message, 'error');
    }
  }

  useEffect(() => { load(); }, [branchFilter]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <span style={{ color: C.textSecondary, fontSize: 14 }}>{vehicles.length} vehicle{vehicles.length !== 1 ? 's' : ''}</span>
        <button onClick={() => setShowAdd(true)} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: C.orange, border: 'none', borderRadius: 6,
          color: '#fff', padding: '8px 18px', cursor: 'pointer', fontWeight: 700, fontSize: 14,
        }}>
          <Plus size={16} /> Add Vehicle
        </button>
      </div>
      {loading ? (
        <div style={{ color: C.textSecondary, textAlign: 'center', padding: 60 }}>Loading vehicles...</div>
      ) : vehicles.length === 0 ? (
        <div style={{ color: C.textSecondary, textAlign: 'center', padding: 60 }}>No vehicles found.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {vehicles.map(v => (
            <div key={v.id} style={{
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              padding: 18,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.orange, letterSpacing: 1, marginBottom: 2 }}>{v.plate_number}</div>
                  <div style={{ color: C.textPrimary, fontWeight: 600, fontSize: 14 }}>{v.year} {v.brand} {v.model}</div>
                  <div style={{ color: C.textSecondary, fontSize: 12 }}>{v.color} &bull; {v.vehicle_type} &bull; {v.fuel_type}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Badge label={v.status.replace('_', ' ')} color={vehicleStatusColor(v.status)} />
                  <button
                    onClick={() => handleDelete(v.id)}
                    title="Delete vehicle"
                    style={{
                      background: 'none',
                      border: `1px solid #EF444444`,
                      borderRadius: 5,
                      color: '#EF4444',
                      padding: '4px 6px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: C.textSecondary, fontSize: 12 }}>
                  <Fuel size={13} />
                  <span>{(v.current_mileage || 0).toLocaleString()} km</span>
                </div>
                {v.assigned_driver_id && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: C.textSecondary, fontSize: 12 }}>
                    <MapPin size={13} />
                    <span>Assigned</span>
                  </div>
                )}
              </div>
              {(v.insurance_expiry || v.road_tax_expiry) && (
                <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {v.insurance_expiry && (
                    <div style={{ fontSize: 11, color: C.textSecondary }}>
                      <span style={{ color: C.textSecondary }}>Ins:</span> {v.insurance_expiry.split('-').reverse().join('/')}
                    </div>
                  )}
                  {v.road_tax_expiry && (
                    <div style={{ fontSize: 11, color: C.textSecondary }}>
                      <span style={{ color: C.textSecondary }}>RT:</span> {v.road_tax_expiry.split('-').reverse().join('/')}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {showAdd && (
        <Modal title="Add Fleet Vehicle" onClose={() => setShowAdd(false)}>
          <AddVehicleForm
            branchId={user?.branch_id || ''}
            onSuccess={load}
            onClose={() => setShowAdd(false)}
          />
        </Modal>
      )}
    </div>
  );
}

interface NewTripForm {
  fleet_vehicle_id: string;
  driver_name: string;
  purpose: string;
  start_mileage: string;
}

interface EndTripForm {
  end_mileage: string;
}

function TripsTab({ branchFilter, isSuperAdmin }: { branchFilter: string | null; isSuperAdmin: boolean }) {
  const { user } = useAuthStore();
  const [trips, setTrips] = useState<FleetTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [endTripTarget, setEndTripTarget] = useState<FleetTrip | null>(null);
  const [newForm, setNewForm] = useState<NewTripForm>({ fleet_vehicle_id: '', driver_name: '', purpose: '', start_mileage: '' });
  const [endForm, setEndForm] = useState<EndTripForm>({ end_mileage: '' });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    let q = supabase
      .from('fleet_trips')
      .select('*, fleet_vehicles(plate_number, brand, model)')
      .order('start_time', { ascending: false })
      .limit(100);
    if (!isSuperAdmin && branchFilter) q = q.eq('branch_id', branchFilter);
    const { data } = await q;
    setTrips(data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    let vq = supabase.from('fleet_vehicles').select('*').eq('status', 'available').order('plate_number');
    if (!isSuperAdmin && branchFilter) vq = vq.eq('branch_id', branchFilter);
    vq.then(({ data }) => setVehicles(data || []));
  }, [branchFilter]);

  async function handleStartTrip(e: React.FormEvent) {
    e.preventDefault();
    if (!newForm.fleet_vehicle_id) return;
    setSaving(true);
    const { error } = await supabase.from('fleet_trips').insert({
      branch_id: user?.branch_id || branchFilter || '',
      tenant_id: user?.tenant_id,
      fleet_vehicle_id: newForm.fleet_vehicle_id,
      driver_id: user?.id || '',
      driver_name: newForm.driver_name || user?.full_name || '',
      purpose: newForm.purpose,
      start_time: new Date().toISOString(),
      start_mileage: Number(newForm.start_mileage) || 0,
    });
    if (!error) {
      await supabase.from('fleet_vehicles').update({ status: 'in_use' }).eq('id', newForm.fleet_vehicle_id);
      toast('Trip started', 'success');
      setShowNew(false);
      setNewForm({ fleet_vehicle_id: '', driver_name: '', purpose: '', start_mileage: '' });
      load();
    } else {
      toast(error.message, 'error');
    }
    setSaving(false);
  }

  async function handleEndTrip(e: React.FormEvent) {
    e.preventDefault();
    if (!endTripTarget) return;
    setSaving(true);
    const endMileage = Number(endForm.end_mileage) || 0;
    const distKm = endMileage > endTripTarget.start_mileage ? endMileage - endTripTarget.start_mileage : null;
    const { error } = await supabase.from('fleet_trips').update({
      end_time: new Date().toISOString(),
      end_mileage: endMileage,
      distance_km: distKm,
    }).eq('id', endTripTarget.id);
    if (!error) {
      await supabase.from('fleet_vehicles').update({ status: 'available', current_mileage: endMileage }).eq('id', endTripTarget.fleet_vehicle_id);
      toast(`Trip ended â€” ${distKm != null ? distKm + ' km' : 'mileage recorded'}`, 'success');
      setEndTripTarget(null);
      setEndForm({ end_mileage: '' });
      load();
    } else {
      toast(error.message, 'error');
    }
    setSaving(false);
  }

  const activeTrips = trips.filter(t => !t.end_time);
  const pastTrips = trips.filter(t => !!t.end_time);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <span style={{ color: C.textSecondary, fontSize: 14 }}>{activeTrips.length} active Â· {pastTrips.length} completed</span>
        <button onClick={() => setShowNew(true)} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: C.orange, border: 'none', borderRadius: 6,
          color: '#fff', padding: '8px 18px', cursor: 'pointer', fontWeight: 700, fontSize: 14,
        }}>
          <Plus size={16} /> Start Trip
        </button>
      </div>

      {loading ? (
        <div style={{ color: C.textSecondary, textAlign: 'center', padding: 60 }}>Loading trips...</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Vehicle', 'Driver', 'Purpose', 'Start', 'End', 'Distance', ''].map((h, i) => (
                  <th key={i} style={{ textAlign: 'left', color: C.textSecondary, padding: '10px 12px', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trips.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: C.textSecondary, padding: 40 }}>No trips found.</td></tr>
              ) : trips.map(t => {
                const isActive = !t.end_time;
                return (
                  <tr key={t.id} style={{ borderBottom: `1px solid ${C.border}22`, background: isActive ? 'rgba(241,90,34,0.04)' : 'transparent' }}>
                    <td style={{ padding: '10px 12px', color: C.orange, fontWeight: 700 }}>
                      {t.fleet_vehicles?.plate_number || 'â€”'}
                      <div style={{ color: C.textSecondary, fontSize: 11, fontWeight: 400 }}>{t.fleet_vehicles?.brand} {t.fleet_vehicles?.model}</div>
                    </td>
                    <td style={{ padding: '10px 12px', color: C.textPrimary }}>{t.driver_name || t.driver_id}</td>
                    <td style={{ padding: '10px 12px', color: C.textPrimary }}>{t.purpose}</td>
                    <td style={{ padding: '10px 12px', color: C.textSecondary }}>{t.start_time ? new Date(t.start_time).toLocaleString() : 'â€”'}</td>
                    <td style={{ padding: '10px 12px', color: C.textSecondary }}>{t.end_time ? new Date(t.end_time).toLocaleString() : <span style={{ color: C.orange, fontWeight: 600 }}>In Progress</span>}</td>
                    <td style={{ padding: '10px 12px', color: C.textPrimary }}>{t.distance_km != null ? `${t.distance_km} km` : 'â€”'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      {isActive && (
                        <button onClick={() => { setEndTripTarget(t); setEndForm({ end_mileage: '' }); }} style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          background: 'none', border: `1px solid ${C.border}`, borderRadius: 5,
                          color: C.textSecondary, padding: '4px 10px', cursor: 'pointer', fontSize: 12,
                        }}>
                          <FlagOff size={12} /> End
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* New Trip Modal */}
      {showNew && (
        <Modal title="Start New Trip" onClose={() => setShowNew(false)}>
          <form onSubmit={handleStartTrip}>
            <FormField label="Vehicle *">
              <select style={selectStyle} value={newForm.fleet_vehicle_id} onChange={e => setNewForm(f => ({ ...f, fleet_vehicle_id: e.target.value }))} required>
                <option value="">Select vehicleâ€¦</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate_number} â€” {v.brand} {v.model}</option>)}
              </select>
            </FormField>
            <FormField label="Driver Name">
              <input style={inputStyle} value={newForm.driver_name} onChange={e => setNewForm(f => ({ ...f, driver_name: e.target.value }))} onBlur={e => setNewForm(f => ({ ...f, driver_name: formatName(e.target.value) }))} placeholder="Leave blank to use your name" />
            </FormField>
            <FormField label="Purpose *">
              <input style={inputStyle} value={newForm.purpose} onChange={e => setNewForm(f => ({ ...f, purpose: e.target.value }))} required placeholder="e.g. Parts delivery to workshop" />
            </FormField>
            <FormField label="Start Mileage (km)">
              <input style={inputStyle} type="number" value={newForm.start_mileage} onChange={e => setNewForm(f => ({ ...f, start_mileage: e.target.value }))} placeholder="0" />
            </FormField>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button type="button" onClick={() => setShowNew(false)} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, color: C.textSecondary, padding: '0 20px', minHeight: 44, cursor: 'pointer', fontSize: 14 }}>Cancel</button>
              <button type="submit" disabled={saving} style={{ background: C.orange, border: 'none', borderRadius: 6, color: '#fff', padding: '0 24px', minHeight: 44, cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>{saving ? 'Startingâ€¦' : 'Start Trip'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* End Trip Modal */}
      {endTripTarget && (
        <Modal title="End Trip" onClose={() => setEndTripTarget(null)}>
          <div style={{ marginBottom: 14, color: C.textSecondary, fontSize: 14 }}>
            Vehicle: <strong style={{ color: C.orange }}>{endTripTarget.fleet_vehicles?.plate_number}</strong> &nbsp;|&nbsp; Purpose: {endTripTarget.purpose}
          </div>
          <form onSubmit={handleEndTrip}>
            <FormField label="End Mileage (km) *">
              <input style={inputStyle} type="number" value={endForm.end_mileage} onChange={e => setEndForm({ end_mileage: e.target.value })} required min={endTripTarget.start_mileage} placeholder={String(endTripTarget.start_mileage)} />
            </FormField>
            {endForm.end_mileage && Number(endForm.end_mileage) > endTripTarget.start_mileage && (
              <div style={{ color: '#22C55E', fontSize: 13, marginBottom: 12 }}>
                Distance: {Number(endForm.end_mileage) - endTripTarget.start_mileage} km
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button type="button" onClick={() => setEndTripTarget(null)} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, color: C.textSecondary, padding: '0 20px', minHeight: 44, cursor: 'pointer', fontSize: 14 }}>Cancel</button>
              <button type="submit" disabled={saving} style={{ background: C.orange, border: 'none', borderRadius: 6, color: '#fff', padding: '0 24px', minHeight: 44, cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>{saving ? 'Endingâ€¦' : 'End Trip'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function IssuesTab({ branchFilter, isSuperAdmin }: { branchFilter: string | null; isSuperAdmin: boolean }) {
  const [issues, setIssues] = useState<FleetIssue[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    let q = supabase
      .from('fleet_issues')
      .select('*, fleet_vehicles(plate_number, brand, model)')
      .order('reported_at', { ascending: false });
    if (!isSuperAdmin && branchFilter) q = q.eq('branch_id', branchFilter);
    const { data } = await q;
    setIssues(data || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [branchFilter]);

  async function markResolved(id: string) {
    await supabase.from('fleet_issues').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', id);
    load();
  }

  return (
    <div>
      {loading ? (
        <div style={{ color: C.textSecondary, textAlign: 'center', padding: 60 }}>Loading issues...</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Vehicle', 'Issue Type', 'Description', 'Severity', 'Reported', 'Status', ''].map((h, i) => (
                  <th key={i} style={{ textAlign: 'left', color: C.textSecondary, padding: '10px 12px', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {issues.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: C.textSecondary, padding: 40 }}>No issues found.</td></tr>
              ) : issues.map(issue => (
                <tr key={issue.id} style={{ borderBottom: `1px solid ${C.border}22` }}>
                  <td style={{ padding: '10px 12px', color: C.orange, fontWeight: 700 }}>
                    {issue.fleet_vehicles?.plate_number || 'â€”'}
                    <div style={{ color: C.textSecondary, fontSize: 11, fontWeight: 400 }}>{issue.fleet_vehicles?.brand} {issue.fleet_vehicles?.model}</div>
                  </td>
                  <td style={{ padding: '10px 12px', color: C.textPrimary }}>{issue.issue_type}</td>
                  <td style={{ padding: '10px 12px', color: C.textSecondary, maxWidth: 200 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{issue.description}</div>
                  </td>
                  <td style={{ padding: '10px 12px' }}><Badge label={issue.severity} color={severityColor(issue.severity)} /></td>
                  <td style={{ padding: '10px 12px', color: C.textSecondary }}>{issue.reported_at ? new Date(issue.reported_at).toLocaleDateString() : 'â€”'}</td>
                  <td style={{ padding: '10px 12px' }}><Badge label={issue.status.replace('_', ' ')} color={issueStatusColor(issue.status)} /></td>
                  <td style={{ padding: '10px 12px' }}>
                    {issue.status !== 'resolved' && (
                      <button onClick={() => markResolved(issue.id)} style={{
                        background: 'none',
                        border: `1px solid #22C55E44`,
                        borderRadius: 5,
                        color: '#22C55E',
                        padding: '4px 10px',
                        cursor: 'pointer',
                        fontSize: 11,
                        fontWeight: 600,
                      }}>Resolve</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const SERVICE_TYPES = [
  'Oil Change', 'Tyre Rotation', 'Brake Service', 'Air Filter', 'Transmission Service',
  'Coolant Flush', 'Battery Replacement', 'Spark Plugs', 'Timing Belt', 'Full Service', 'Other',
];

function NextServiceCard({ record, currentMileage }: { record: FleetMaintenance; currentMileage: number }) {
  const today = new Date();
  const nextDate = record.next_service_date ? new Date(record.next_service_date) : null;
  const daysLeft = nextDate ? Math.ceil((nextDate.getTime() - today.getTime()) / 86400000) : null;
  const kmLeft = record.next_service_mileage ? record.next_service_mileage - currentMileage : null;

  const isDateOverdue = daysLeft !== null && daysLeft < 0;
  const isKmOverdue = kmLeft !== null && kmLeft <= 0;
  const isOverdue = isDateOverdue || isKmOverdue;
  const isDueSoon = !isOverdue && ((daysLeft !== null && daysLeft <= 14) || (kmLeft !== null && kmLeft <= 500));

  const color = isOverdue ? '#EF4444' : isDueSoon ? '#F59E0B' : '#22C55E';

  return (
    <div style={{
      background: C.surface, border: `1px solid ${color}44`, borderRadius: 10,
      padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14,
    }}>
      <div style={{ width: 40, height: 40, borderRadius: '50%', background: `${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {isOverdue ? <AlertTriangle size={18} color={color} /> : isDueSoon ? <Clock size={18} color={color} /> : <CheckCircle2 size={18} color={color} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>
          {isOverdue ? 'Overdue' : isDueSoon ? 'Due Soon' : 'Upcoming'} â€” Next {record.service_type}
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {nextDate && (
            <span style={{ fontSize: 12, color: C.textSecondary }}>
              <span style={{ color: isDateOverdue ? '#EF4444' : C.textPrimary, fontWeight: 600 }}>
                {nextDate.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
              {daysLeft !== null && (
                <span style={{ color: isDateOverdue ? '#EF4444' : isDueSoon ? '#F59E0B' : C.textSecondary }}>
                  {' '}({isDateOverdue ? `${Math.abs(daysLeft)}d overdue` : daysLeft === 0 ? 'today' : `${daysLeft}d left`})
                </span>
              )}
            </span>
          )}
          {record.next_service_mileage && (
            <span style={{ fontSize: 12, color: C.textSecondary }}>
              at <span style={{ color: isKmOverdue ? '#EF4444' : C.textPrimary, fontWeight: 600 }}>{record.next_service_mileage.toLocaleString()} km</span>
              {kmLeft !== null && (
                <span style={{ color: isKmOverdue ? '#EF4444' : C.textSecondary }}>
                  {' '}({isKmOverdue ? `${Math.abs(kmLeft)} km overdue` : `${kmLeft} km left`})
                </span>
              )}
            </span>
          )}
        </div>
        {record.remarks && <div style={{ fontSize: 11, color: '#666', marginTop: 3 }}>{record.remarks}</div>}
      </div>
    </div>
  );
}

function LogServiceModal({ vehicles, branchId, tenantId, tenantName, onClose, onSaved }: {
  vehicles: FleetVehicle[];
  branchId: string;
  tenantId: string | null;
  tenantName: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuthStore();
  const [form, setForm] = useState({
    fleet_vehicle_id: vehicles[0]?.id || '',
    service_date: new Date().toISOString().slice(0, 10),
    service_type: 'Oil Change',
    service_mileage: '',
    workshop_vendor: '',
    parts_changed: '',
    labour_cost: '',
    parts_cost: '',
    next_service_date: '',
    next_service_mileage: '',
    remarks: '',
  });
  const [saving, setSaving] = useState(false);
  const [vendors, setVendors] = useState<string[]>([]);
  const [addingVendor, setAddingVendor] = useState(false);
  const [newVendorName, setNewVendorName] = useState('');
  const [savingVendor, setSavingVendor] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    async function fetchVendors() {
      const seedName = tenantName || 'Motoverse Garage';
      if (!tenantId) {
        setVendors([seedName]);
        setForm(f => ({ ...f, workshop_vendor: seedName }));
        return;
      }
      try {
        const { data: existing, error } = await supabase
          .from('fleet_vendors').select('name').eq('tenant_id', tenantId).order('name');
        if (error || !existing || existing.length === 0) {
          // table may not exist yet or is empty â€” show seed name locally only
          setVendors([seedName]);
          setForm(f => ({ ...f, workshop_vendor: seedName }));
          if (!error) {
            // table exists but empty â€” insert seed silently
            supabase.from('fleet_vendors').insert({ tenant_id: tenantId, name: seedName }).then(() => {});
          }
        } else {
          setVendors(existing.map((r: { name: string }) => r.name));
          setForm(f => ({ ...f, workshop_vendor: existing[0].name }));
        }
      } catch (_e) {
        const seedName2 = tenantName || 'Motoverse Garage';
        setVendors([seedName2]);
        setForm(f => ({ ...f, workshop_vendor: seedName2 }));
      }
    }
    fetchVendors();
  }, [tenantId, tenantName]);

  async function handleAddVendor() {
    const name = newVendorName.trim();
    if (!name || !tenantId) return;
    setSavingVendor(true);
    const { error } = await supabase.from('fleet_vendors').insert({ tenant_id: tenantId, name });
    setSavingVendor(false);
    if (error) { toast(error.message, 'error'); return; }
    setVendors(v => [...v, name].sort());
    setForm(f => ({ ...f, workshop_vendor: name }));
    setNewVendorName('');
    setAddingVendor(false);
  }

  const totalCost = (parseFloat(form.labour_cost) || 0) + (parseFloat(form.parts_cost) || 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from('fleet_maintenance').insert({
      branch_id: branchId,
      tenant_id: tenantId,
      fleet_vehicle_id: form.fleet_vehicle_id,
      service_date: form.service_date,
      service_type: form.service_type,
      service_mileage: form.service_mileage ? parseInt(form.service_mileage) : null,
      workshop_vendor: form.workshop_vendor || null,
      parts_changed: form.parts_changed || null,
      labour_cost: parseFloat(form.labour_cost) || 0,
      parts_cost: parseFloat(form.parts_cost) || 0,
      total_cost: totalCost,
      next_service_date: form.next_service_date || null,
      next_service_mileage: form.next_service_mileage ? parseInt(form.next_service_mileage) : null,
      remarks: form.remarks || null,
      updated_by: user?.id,
    });
    setSaving(false);
    if (error) { toast(error.message, 'error'); return; }
    // update vehicle mileage if provided
    if (form.service_mileage) {
      await supabase.from('fleet_vehicles').update({ current_mileage: parseInt(form.service_mileage) }).eq('id', form.fleet_vehicle_id);
    }
    logAudit({ action: 'Service Logged', module: 'Fleet', record_type: 'fleet_maintenance', details: { service_type: form.service_type, vehicle_id: form.fleet_vehicle_id }, branch_id: branchId, user_id: user?.id, tenant_id: tenantId });
    toast('Service logged', 'success');
    onSaved();
    onClose();
  }

  return (
    <Modal title="Log Service / Maintenance" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Vehicle *">
            <select style={selectStyle} value={form.fleet_vehicle_id} onChange={e => set('fleet_vehicle_id', e.target.value)} required>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate_number} â€” {v.brand} {v.model}</option>)}
            </select>
          </FormField>
          <FormField label="Service Type *">
            <select style={selectStyle} value={form.service_type} onChange={e => set('service_type', e.target.value)}>
              {SERVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormField>
          <FormField label="Service Date *">
            <DatePickerInput value={form.service_date} onChange={v => set('service_date', v)} />
          </FormField>
          <FormField label="Mileage at Service (km)">
            <input style={inputStyle} type="number" value={form.service_mileage} onChange={e => set('service_mileage', e.target.value)} placeholder="e.g. 45000" />
          </FormField>
          <FormField label="Workshop / Vendor">
            {addingVendor ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  value={newVendorName}
                  onChange={e => setNewVendorName(e.target.value)}
                  onBlur={e => setNewVendorName(formatTitleCase(e.target.value))}
                  placeholder="New workshop name"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddVendor(); } if (e.key === 'Escape') setAddingVendor(false); }}
                />
                <button type="button" onClick={handleAddVendor} disabled={savingVendor} style={{ padding: '0 12px', background: C.orange, color: '#000', border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                  {savingVendor ? '...' : 'Save'}
                </button>
                <button type="button" onClick={() => setAddingVendor(false)} style={{ padding: '0 10px', background: C.surface, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                  âœ•
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                <select style={{ ...selectStyle, flex: 1 }} value={form.workshop_vendor} onChange={e => set('workshop_vendor', e.target.value)}>
                  <option value="">â€” Select workshop â€”</option>
                  {vendors.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                <button type="button" onClick={() => setAddingVendor(true)} style={{ padding: '0 10px', background: C.surface, color: C.orange, border: `1px solid ${C.orange}`, borderRadius: 6, cursor: 'pointer', fontSize: 18, lineHeight: 1 }} title="Add new workshop">
                  +
                </button>
              </div>
            )}
          </FormField>
          <FormField label="Parts Changed">
            <input style={inputStyle} value={form.parts_changed} onChange={e => set('parts_changed', e.target.value)} placeholder="e.g. Oil filter, engine oil" />
          </FormField>
          <FormField label="Labour Cost (RM)">
            <input style={inputStyle} type="number" step="0.01" value={form.labour_cost} onChange={e => set('labour_cost', e.target.value)} placeholder="0.00" />
          </FormField>
          <FormField label="Parts Cost (RM)">
            <input style={inputStyle} type="number" step="0.01" value={form.parts_cost} onChange={e => set('parts_cost', e.target.value)} placeholder="0.00" />
          </FormField>
        </div>

        {totalCost > 0 && (
          <div style={{ background: '#0E0E0E', borderRadius: 8, padding: '10px 14px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: C.textSecondary, fontSize: 13 }}>Total Cost</span>
            <span style={{ color: C.orange, fontWeight: 700, fontSize: 15 }}>RM {totalCost.toFixed(2)}</span>
          </div>
        )}

        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, marginBottom: 4 }}>
          <p style={{ fontSize: 12, color: '#666', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 12px' }}>Next Service Recommendation</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Next Service Date">
            <DatePickerInput value={form.next_service_date} onChange={v => set('next_service_date', v)} />
          </FormField>
          <FormField label="Next Service Mileage (km)">
            <input style={inputStyle} type="number" value={form.next_service_mileage} onChange={e => set('next_service_mileage', e.target.value)} placeholder="e.g. 50000" />
          </FormField>
        </div>

        <FormField label="Remarks">
          <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 56 }} value={form.remarks} onChange={e => set('remarks', e.target.value)} placeholder="Any notes about the serviceâ€¦" />
        </FormField>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
          <button type="button" onClick={onClose} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, color: C.textSecondary, padding: '0 20px', minHeight: 44, cursor: 'pointer', fontSize: 14 }}>Cancel</button>
          <button type="submit" disabled={saving} style={{ background: C.orange, border: 'none', borderRadius: 6, color: '#fff', padding: '0 24px', minHeight: 44, cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>{saving ? 'Savingâ€¦' : 'Log Service'}</button>
        </div>
      </form>
    </Modal>
  );
}

function MaintenanceTab({ branchFilter, isSuperAdmin }: { branchFilter: string | null; isSuperAdmin: boolean }) {
  const { user } = useAuthStore();
  const [records, setRecords] = useState<FleetMaintenance[]>([]);
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [showLog, setShowLog] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('fleet_maintenance')
      .select('*, fleet_vehicles(plate_number, brand, model, current_mileage)')
      .order('service_date', { ascending: false });
    if (!isSuperAdmin && branchFilter) q = q.eq('branch_id', branchFilter);
    if (selectedVehicle !== 'all') q = q.eq('fleet_vehicle_id', selectedVehicle);
    const { data } = await q;
    setRecords(data || []);
    setLoading(false);
  }, [branchFilter, isSuperAdmin, selectedVehicle]);

  useEffect(() => {
    load();
    let vq = supabase.from('fleet_vehicles').select('*').order('plate_number');
    if (!isSuperAdmin && branchFilter) vq = vq.eq('branch_id', branchFilter);
    vq.then(({ data }) => setVehicles(data || []));
  }, [load]);

  // Latest record per vehicle â€” used for Next Service cards
  const latestByVehicle = records.reduce<Record<string, FleetMaintenance>>((acc, r) => {
    if (!acc[r.fleet_vehicle_id] || r.service_date > acc[r.fleet_vehicle_id].service_date) {
      acc[r.fleet_vehicle_id] = r;
    }
    return acc;
  }, {});

  const nextServiceCards = Object.values(latestByVehicle).filter(r => r.next_service_date || r.next_service_mileage);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      <ServiceAlertsBar vehicles={vehicles} records={records} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select
            value={selectedVehicle}
            onChange={e => setSelectedVehicle(e.target.value)}
            style={{ ...selectStyle, width: 'auto', minWidth: 180, fontSize: 13 }}
          >
            <option value="all">All Vehicles</option>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate_number} â€” {v.brand} {v.model}</option>)}
          </select>
          <span style={{ color: C.textSecondary, fontSize: 13 }}>{records.length} record{records.length !== 1 ? 's' : ''}</span>
        </div>
        <button onClick={() => setShowLog(true)} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: C.orange, border: 'none', borderRadius: 6,
          color: '#fff', padding: '8px 18px', cursor: 'pointer', fontWeight: 700, fontSize: 14,
        }}>
          <Plus size={16} /> Log Service
        </button>
      </div>

      {/* Next Service Cards */}
      {nextServiceCards.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <CalendarClock size={15} color={C.orange} />
            <span style={{ fontSize: 12, fontWeight: 700, color: C.orange, textTransform: 'uppercase', letterSpacing: 0.5 }}>Next Service Schedule</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {nextServiceCards.map(r => {
              const veh = vehicles.find(v => v.id === r.fleet_vehicle_id);
              return (
                <div key={r.id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <ChevronRight size={12} color={C.textSecondary} />
                    <span style={{ fontSize: 11, color: C.textSecondary, fontWeight: 600 }}>
                      {(r.fleet_vehicles as any)?.plate_number} â€” {(r.fleet_vehicles as any)?.brand} {(r.fleet_vehicles as any)?.model}
                    </span>
                  </div>
                  <NextServiceCard record={r} currentMileage={veh?.current_mileage ?? (r.fleet_vehicles as any)?.current_mileage ?? 0} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* History Table */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Wrench size={15} color={C.textSecondary} />
          <span style={{ fontSize: 12, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>Service History</span>
        </div>
        {loading ? (
          <div style={{ color: C.textSecondary, textAlign: 'center', padding: 60 }}>Loading...</div>
        ) : records.length === 0 ? (
          <div style={{ color: C.textSecondary, textAlign: 'center', padding: 60, background: C.surface, borderRadius: 10, border: `1px solid ${C.border}` }}>
            <Wrench size={32} color={C.border} style={{ marginBottom: 10 }} />
            <p style={{ margin: 0 }}>No maintenance records yet. Log the first service above.</p>
          </div>
        ) : (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {['Vehicle', 'Date', 'Service Type', 'Mileage', 'Vendor', 'Parts Changed', 'Total (RM)', 'Next Due'].map(h => (
                    <th key={h} style={{ textAlign: 'left', color: C.textSecondary, padding: '10px 12px', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map(r => {
                  const nextDate = r.next_service_date ? new Date(r.next_service_date) : null;
                  const isNextOverdue = nextDate ? nextDate < new Date() : false;
                  return (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}22` }}>
                      <td style={{ padding: '10px 12px', color: C.orange, fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {(r.fleet_vehicles as any)?.plate_number || 'â€”'}
                        <div style={{ color: C.textSecondary, fontSize: 11, fontWeight: 400 }}>{(r.fleet_vehicles as any)?.brand} {(r.fleet_vehicles as any)?.model}</div>
                      </td>
                      <td style={{ padding: '10px 12px', color: C.textPrimary, whiteSpace: 'nowrap' }}>
                        {new Date(r.service_date).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ background: `${C.orange}22`, color: C.orange, border: `1px solid ${C.orange}44`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {r.service_type}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', color: C.textSecondary, whiteSpace: 'nowrap' }}>
                        {r.service_mileage ? `${r.service_mileage.toLocaleString()} km` : 'â€”'}
                      </td>
                      <td style={{ padding: '10px 12px', color: C.textSecondary }}>{r.workshop_vendor || 'â€”'}</td>
                      <td style={{ padding: '10px 12px', color: C.textSecondary, maxWidth: 160 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.parts_changed || 'â€”'}</div>
                      </td>
                      <td style={{ padding: '10px 12px', color: C.textPrimary, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {r.total_cost > 0 ? `RM ${r.total_cost.toFixed(2)}` : 'â€”'}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        {nextDate ? (
                          <span style={{ fontSize: 12, color: isNextOverdue ? '#EF4444' : '#22C55E', fontWeight: 600 }}>
                            {nextDate.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
                            {r.next_service_mileage ? ` / ${r.next_service_mileage.toLocaleString()} km` : ''}
                          </span>
                        ) : r.next_service_mileage ? (
                          <span style={{ fontSize: 12, color: C.textSecondary }}>{r.next_service_mileage.toLocaleString()} km</span>
                        ) : 'â€”'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showLog && (
        <LogServiceModal
          vehicles={vehicles}
          branchId={branchFilter || user?.branch_id || ''}
          tenantId={user?.tenant_id || null}
          tenantName={null}
          onClose={() => setShowLog(false)}
          onSaved={load}
        />
      )}
    </div>
  );
}

// â”€â”€â”€ FUEL LOG â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface FuelLog {
  id: string;
  fleet_vehicle_id: string;
  log_date: string;
  litres: number;
  cost_per_litre: number;
  total_cost: number;
  odometer_km: number;
  station: string | null;
  full_tank: boolean;
  fleet_vehicles?: { plate_number: string; brand: string; model: string };
}

function FuelLogTab({ branchFilter, isSuperAdmin }: { branchFilter: string | null; isSuperAdmin: boolean }) {
  const { user } = useAuthStore();
  const [logs, setLogs] = useState<FuelLog[]>([]);
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    fleet_vehicle_id: '', log_date: new Date().toISOString().slice(0, 10),
    litres: '', cost_per_litre: '', odometer_km: '', station: '', full_tank: true,
  });
  const [saving, setSaving] = useState(false);
  const setF = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('fleet_fuel_logs')
      .select('*, fleet_vehicles(plate_number, brand, model)')
      .order('log_date', { ascending: false }).order('created_at', { ascending: false });
    if (!isSuperAdmin && branchFilter) q = q.eq('branch_id', branchFilter);
    const { data } = await q;
    setLogs(data || []);
    setLoading(false);
  }, [branchFilter, isSuperAdmin]);

  useEffect(() => {
    load();
    let vq = supabase.from('fleet_vehicles').select('*').order('plate_number');
    if (!isSuperAdmin && branchFilter) vq = vq.eq('branch_id', branchFilter);
    vq.then(({ data }) => {
      const v = data || [];
      setVehicles(v);
      if (v.length > 0) setForm(f => ({ ...f, fleet_vehicle_id: v[0].id }));
    });
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const veh = vehicles.find(v => v.id === form.fleet_vehicle_id);
    if (!veh) return;
    setSaving(true);
    const total = parseFloat(form.litres) * parseFloat(form.cost_per_litre);
    const { error } = await supabase.from('fleet_fuel_logs').insert({
      tenant_id: user?.tenant_id,
      branch_id: veh.branch_id,
      fleet_vehicle_id: form.fleet_vehicle_id,
      log_date: form.log_date,
      litres: parseFloat(form.litres),
      cost_per_litre: parseFloat(form.cost_per_litre),
      total_cost: total,
      odometer_km: parseInt(form.odometer_km),
      station: form.station || null,
      full_tank: form.full_tank,
      recorded_by: user?.id,
    });
    setSaving(false);
    if (error) { toast(error.message, 'error'); return; }
    // update vehicle mileage
    await supabase.from('fleet_vehicles').update({ current_mileage: parseInt(form.odometer_km) }).eq('id', form.fleet_vehicle_id);
    logAudit({ action: 'Fuel Log Added', module: 'Fleet', record_type: 'fleet_fuel_logs', details: { litres: form.litres, odometer: form.odometer_km, station: form.station }, branch_id: veh.branch_id, user_id: user?.id, tenant_id: user?.tenant_id });
    toast('Fuel log saved', 'success');
    setShowForm(false);
    load();
  }

  // compute efficiency: km/litre between consecutive full-tank fills per vehicle
  const efficiencyByVehicle: Record<string, number | null> = {};
  const byVehicle: Record<string, FuelLog[]> = {};
  logs.forEach(l => { (byVehicle[l.fleet_vehicle_id] = byVehicle[l.fleet_vehicle_id] || []).push(l); });
  Object.entries(byVehicle).forEach(([vid, vLogs]) => {
    const full = vLogs.filter(l => l.full_tank).sort((a, b) => b.odometer_km - a.odometer_km);
    if (full.length >= 2) {
      const km = full[0].odometer_km - full[1].odometer_km;
      const litres = full[0].litres;
      efficiencyByVehicle[vid] = litres > 0 ? km / litres : null;
    } else {
      efficiencyByVehicle[vid] = null;
    }
  });

  const totalSpend = logs.reduce((s, l) => s + l.total_cost, 0);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ background: '#1A1A1A', borderRadius: 8, padding: '10px 16px' }}>
            <div style={{ fontSize: 11, color: C.textSecondary, fontWeight: 600, textTransform: 'uppercase' }}>Total Spend</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.orange }}>RM {totalSpend.toFixed(2)}</div>
          </div>
          {Object.entries(efficiencyByVehicle).map(([vid, eff]) => {
            const veh = vehicles.find(v => v.id === vid);
            if (!veh || eff === null) return null;
            return (
              <div key={vid} style={{ background: '#1A1A1A', borderRadius: 8, padding: '10px 16px' }}>
                <div style={{ fontSize: 11, color: C.textSecondary, fontWeight: 600, textTransform: 'uppercase' }}>{veh.plate_number} Efficiency</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#22C55E' }}>{eff.toFixed(1)} km/L</div>
              </div>
            );
          })}
        </div>
        <button onClick={() => setShowForm(true)} style={{ background: C.orange, border: 'none', borderRadius: 8, color: '#fff', padding: '10px 18px', cursor: 'pointer', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={16} /> Log Fuel
        </button>
      </div>

      {showForm && (
        <div style={{ background: '#1A1A1A', border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: C.textPrimary }}>Log Fuel Fill-up</span>
            <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textSecondary }}><X size={18} /></button>
          </div>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <FormField label="Vehicle *">
                <select style={selectStyle} value={form.fleet_vehicle_id} onChange={e => setF('fleet_vehicle_id', e.target.value)} required>
                  {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate_number} â€” {v.brand} {v.model}</option>)}
                </select>
              </FormField>
              <FormField label="Date *">
                <DatePickerInput value={form.log_date} onChange={v => setF('log_date', v)} />
              </FormField>
              <FormField label="Station / Petrol Brand">
                <input style={inputStyle} value={form.station} onChange={e => setF('station', e.target.value)} onBlur={e => setF('station', formatTitleCase(e.target.value))} placeholder="e.g. Petronas, Shell" />
              </FormField>
              <FormField label="Litres *">
                <input style={inputStyle} type="number" step="0.01" value={form.litres} onChange={e => setF('litres', e.target.value)} placeholder="e.g. 45.50" required />
              </FormField>
              <FormField label="Price per Litre (RM) *">
                <input style={inputStyle} type="number" step="0.001" value={form.cost_per_litre} onChange={e => setF('cost_per_litre', e.target.value)} placeholder="e.g. 2.050" required />
              </FormField>
              <FormField label="Odometer (km) *">
                <input style={inputStyle} type="number" value={form.odometer_km} onChange={e => setF('odometer_km', e.target.value)} placeholder="e.g. 109000" required />
              </FormField>
            </div>
            {form.litres && form.cost_per_litre && (
              <div style={{ background: '#0E0E0E', borderRadius: 8, padding: '8px 14px', marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: C.textSecondary, fontSize: 13 }}>Total Cost</span>
                <span style={{ color: C.orange, fontWeight: 700 }}>RM {(parseFloat(form.litres) * parseFloat(form.cost_per_litre)).toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <input type="checkbox" id="full_tank" checked={form.full_tank} onChange={e => setF('full_tank', e.target.checked)} style={{ width: 16, height: 16, accentColor: C.orange }} />
              <label htmlFor="full_tank" style={{ color: C.textSecondary, fontSize: 13, cursor: 'pointer' }}>Full tank (used for efficiency calculation)</label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" onClick={() => setShowForm(false)} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, color: C.textSecondary, padding: '0 18px', minHeight: 40, cursor: 'pointer' }}>Cancel</button>
              <button type="submit" disabled={saving} style={{ background: C.orange, border: 'none', borderRadius: 6, color: '#fff', padding: '0 22px', minHeight: 40, cursor: 'pointer', fontWeight: 700 }}>{saving ? 'Savingâ€¦' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ fontSize: 12, color: C.textSecondary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Droplets size={13} /> Fuel History
      </div>
      {loading ? (
        <div style={{ color: C.textSecondary, textAlign: 'center', padding: 40 }}>Loadingâ€¦</div>
      ) : logs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: C.textSecondary }}>
          <Fuel size={32} color={C.border} style={{ marginBottom: 8 }} />
          <div>No fuel logs yet. Log the first fill-up above.</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Vehicle','Date','Station','Litres','RM/L','Total','Odometer','Tank'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: C.textSecondary, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((l, i) => (
                <tr key={l.id} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? 'transparent' : '#0E0E0E' }}>
                  <td style={{ padding: '10px 12px', color: C.orange, fontWeight: 700 }}>
                    {l.fleet_vehicles?.plate_number || 'â€”'}
                    <div style={{ color: C.textSecondary, fontSize: 11, fontWeight: 400 }}>{l.fleet_vehicles?.brand} {l.fleet_vehicles?.model}</div>
                  </td>
                  <td style={{ padding: '10px 12px', color: C.textPrimary }}>{l.log_date.split('-').reverse().join('/')}</td>
                  <td style={{ padding: '10px 12px', color: C.textSecondary }}>{l.station || 'â€”'}</td>
                  <td style={{ padding: '10px 12px', color: C.textPrimary }}>{l.litres.toFixed(2)} L</td>
                  <td style={{ padding: '10px 12px', color: C.textSecondary }}>RM {l.cost_per_litre.toFixed(3)}</td>
                  <td style={{ padding: '10px 12px', color: C.textPrimary, fontWeight: 600 }}>RM {l.total_cost.toFixed(2)}</td>
                  <td style={{ padding: '10px 12px', color: C.textSecondary }}>{l.odometer_km.toLocaleString()} km</td>
                  <td style={{ padding: '10px 12px' }}>
                    {l.full_tank ? <span style={{ color: '#22C55E', fontSize: 11, fontWeight: 600 }}>Full</span> : <span style={{ color: C.textSecondary, fontSize: 11 }}>Partial</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// â”€â”€â”€ DOCUMENT VAULT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface FleetDoc {
  id: string;
  fleet_vehicle_id: string;
  document_type: string;
  file_url: string;
  expiry_date: string | null;
  notes: string | null;
  created_at: string;
  fleet_vehicles?: { plate_number: string; brand: string; model: string };
}

const DOC_TYPES = ['Road Tax', 'Insurance Policy', 'Puspakom Inspection', 'JPJ Ownership', 'Service Invoice', 'Other'];

function DocumentVaultTab({ branchFilter, isSuperAdmin }: { branchFilter: string | null; isSuperAdmin: boolean }) {
  const { user } = useAuthStore();
  const [docs, setDocs] = useState<FleetDoc[]>([]);
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ fleet_vehicle_id: '', document_type: 'Road Tax', expiry_date: '', notes: '' });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('fleet_documents')
      .select('*, fleet_vehicles(plate_number, brand, model)')
      .order('created_at', { ascending: false });
    if (!isSuperAdmin && branchFilter) q = q.eq('branch_id', branchFilter);
    const { data } = await q;
    setDocs(data || []);
    setLoading(false);
  }, [branchFilter, isSuperAdmin]);

  useEffect(() => {
    load();
    let vq = supabase.from('fleet_vehicles').select('*').order('plate_number');
    if (!isSuperAdmin && branchFilter) vq = vq.eq('branch_id', branchFilter);
    vq.then(({ data }) => {
      const v = data || [];
      setVehicles(v);
      if (v.length > 0) setForm(f => ({ ...f, fleet_vehicle_id: v[0].id }));
    });
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { toast('Please select a file', 'error'); return; }
    const veh = vehicles.find(v => v.id === form.fleet_vehicle_id);
    if (!veh) return;
    setSaving(true);
    // upload file to Supabase Storage
    const ext = file.name.split('.').pop();
    const path = `fleet-docs/${form.fleet_vehicle_id}/${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabase.storage.from('fleet-documents').upload(path, file);
    if (uploadErr) { toast('Upload failed: ' + uploadErr.message, 'error'); setSaving(false); return; }
    const { data: { publicUrl } } = supabase.storage.from('fleet-documents').getPublicUrl(path);
    const { error } = await supabase.from('fleet_documents').insert({
      tenant_id: user?.tenant_id,
      branch_id: veh.branch_id,
      fleet_vehicle_id: form.fleet_vehicle_id,
      document_type: form.document_type,
      file_url: publicUrl,
      expiry_date: form.expiry_date || null,
      notes: form.notes || null,
      uploaded_by: user?.id,
    });
    setSaving(false);
    if (error) { toast(error.message, 'error'); return; }
    logAudit({ action: 'Document Uploaded', module: 'Fleet', record_type: 'fleet_documents', details: { document_type: form.document_type, vehicle_id: form.fleet_vehicle_id, expiry: form.expiry_date }, branch_id: veh.branch_id, user_id: user?.id, tenant_id: user?.tenant_id });
    toast('Document uploaded', 'success');
    setShowForm(false);
    setFile(null);
    load();
  }

  async function handleDelete(doc: FleetDoc) {
    if (!confirm(`Delete ${doc.document_type}?`)) return;
    await supabase.from('fleet_documents').delete().eq('id', doc.id);
    setDocs(d => d.filter(x => x.id !== doc.id));
    toast('Deleted', 'success');
  }

  function expiryStatus(expiry: string | null): { color: string; label: string } {
    if (!expiry) return { color: C.textSecondary, label: 'â€”' };
    const days = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000);
    if (days < 0) return { color: '#EF4444', label: `Expired ${Math.abs(days)}d ago` };
    if (days <= 30) return { color: '#F15A22', label: `${days}d left` };
    if (days <= 90) return { color: '#EAB308', label: `${days}d left` };
    return { color: '#22C55E', label: expiry.split('-').reverse().join('/') };
  }

  // Alerts: docs expiring within 60 days or already expired
  const alerts = docs.filter(d => {
    if (!d.expiry_date) return false;
    const days = Math.ceil((new Date(d.expiry_date).getTime() - Date.now()) / 86400000);
    return days <= 60;
  });

  return (
    <div>
      {alerts.length > 0 && (
        <div style={{ background: '#1A0A00', border: `1px solid ${C.orange}44`, borderRadius: 10, padding: '12px 16px', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <BellRing size={14} color={C.orange} />
            <span style={{ fontSize: 12, fontWeight: 700, color: C.orange, textTransform: 'uppercase', letterSpacing: 0.5 }}>Document Expiry Alerts</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {alerts.map(d => {
              const { color, label } = expiryStatus(d.expiry_date);
              return (
                <div key={d.id} style={{ background: '#0E0E0E', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', fontSize: 12 }}>
                  <span style={{ color: C.textPrimary, fontWeight: 600 }}>{d.fleet_vehicles?.plate_number} â€” {d.document_type}</span>
                  <span style={{ color, marginLeft: 8 }}>{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: C.textSecondary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileText size={13} /> {docs.length} document{docs.length !== 1 ? 's' : ''}
        </span>
        <button onClick={() => setShowForm(true)} style={{ background: C.orange, border: 'none', borderRadius: 8, color: '#fff', padding: '10px 18px', cursor: 'pointer', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Upload size={15} /> Upload Document
        </button>
      </div>

      {showForm && (
        <div style={{ background: '#1A1A1A', border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: C.textPrimary }}>Upload Document</span>
            <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textSecondary }}><X size={18} /></button>
          </div>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <FormField label="Vehicle *">
                <select style={selectStyle} value={form.fleet_vehicle_id} onChange={e => setF('fleet_vehicle_id', e.target.value)} required>
                  {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate_number} â€” {v.brand} {v.model}</option>)}
                </select>
              </FormField>
              <FormField label="Document Type *">
                <select style={selectStyle} value={form.document_type} onChange={e => setF('document_type', e.target.value)}>
                  {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </FormField>
              <FormField label="Expiry Date">
                <DatePickerInput value={form.expiry_date} onChange={v => setF('expiry_date', v)} />
              </FormField>
              <FormField label="Notes">
                <input style={inputStyle} value={form.notes} onChange={e => setF('notes', e.target.value)} placeholder="Optional notes" />
              </FormField>
            </div>
            <FormField label="File *">
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setFile(e.target.files?.[0] || null)} required
                style={{ ...inputStyle, padding: '8px 12px', cursor: 'pointer' }} />
            </FormField>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button type="button" onClick={() => setShowForm(false)} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, color: C.textSecondary, padding: '0 18px', minHeight: 40, cursor: 'pointer' }}>Cancel</button>
              <button type="submit" disabled={saving} style={{ background: C.orange, border: 'none', borderRadius: 6, color: '#fff', padding: '0 22px', minHeight: 40, cursor: 'pointer', fontWeight: 700 }}>{saving ? 'Uploadingâ€¦' : 'Upload'}</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div style={{ color: C.textSecondary, textAlign: 'center', padding: 40 }}>Loadingâ€¦</div>
      ) : docs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: C.textSecondary }}>
          <FileText size={32} color={C.border} style={{ marginBottom: 8 }} />
          <div>No documents yet. Upload the first one above.</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Vehicle','Type','Expiry','Notes','File',''].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: C.textSecondary, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docs.map((d, i) => {
                const { color, label } = expiryStatus(d.expiry_date);
                return (
                  <tr key={d.id} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? 'transparent' : '#0E0E0E' }}>
                    <td style={{ padding: '10px 12px', color: C.orange, fontWeight: 700 }}>
                      {d.fleet_vehicles?.plate_number || 'â€”'}
                      <div style={{ color: C.textSecondary, fontSize: 11, fontWeight: 400 }}>{d.fleet_vehicles?.brand} {d.fleet_vehicles?.model}</div>
                    </td>
                    <td style={{ padding: '10px 12px', color: C.textPrimary }}>{d.document_type}</td>
                    <td style={{ padding: '10px 12px', color, fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</td>
                    <td style={{ padding: '10px 12px', color: C.textSecondary }}>{d.notes || 'â€”'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <a href={d.file_url} target="_blank" rel="noopener noreferrer" style={{ color: C.orange, fontSize: 12, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <FileText size={13} /> View
                      </a>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <button onClick={() => handleDelete(d)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', padding: 4 }}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// â”€â”€â”€ SERVICE ALERTS (injected into MaintenanceTab header) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ServiceAlertsBar({ vehicles, records }: { vehicles: FleetVehicle[]; records: FleetMaintenance[] }) {
  const today = new Date();
  const alerts: { plate: string; msg: string; color: string }[] = [];

  vehicles.forEach(veh => {
    const latest = records
      .filter(r => r.fleet_vehicle_id === veh.id && (r.next_service_date || r.next_service_mileage))
      .sort((a, b) => b.service_date.localeCompare(a.service_date))[0];
    if (!latest) return;

    if (latest.next_service_date) {
      const days = Math.ceil((new Date(latest.next_service_date).getTime() - today.getTime()) / 86400000);
      if (days < 0) alerts.push({ plate: veh.plate_number, msg: `Service overdue by ${Math.abs(days)} days`, color: '#EF4444' });
      else if (days <= 14) alerts.push({ plate: veh.plate_number, msg: `Service due in ${days} day${days !== 1 ? 's' : ''}`, color: '#F15A22' });
    }
    if (latest.next_service_mileage && veh.current_mileage) {
      const remaining = latest.next_service_mileage - veh.current_mileage;
      if (remaining <= 0) alerts.push({ plate: veh.plate_number, msg: `Mileage service overdue by ${Math.abs(remaining).toLocaleString()} km`, color: '#EF4444' });
      else if (remaining <= 2000) alerts.push({ plate: veh.plate_number, msg: `${remaining.toLocaleString()} km until next service`, color: '#EAB308' });
    }

    // insurance expiry
    if (veh.insurance_expiry) {
      const days = Math.ceil((new Date(veh.insurance_expiry).getTime() - today.getTime()) / 86400000);
      if (days < 0) alerts.push({ plate: veh.plate_number, msg: `Insurance EXPIRED`, color: '#EF4444' });
      else if (days <= 30) alerts.push({ plate: veh.plate_number, msg: `Insurance expires in ${days}d`, color: '#F15A22' });
    }
    // road tax expiry
    if (veh.road_tax_expiry) {
      const days = Math.ceil((new Date(veh.road_tax_expiry).getTime() - today.getTime()) / 86400000);
      if (days < 0) alerts.push({ plate: veh.plate_number, msg: `Road Tax EXPIRED`, color: '#EF4444' });
      else if (days <= 30) alerts.push({ plate: veh.plate_number, msg: `Road Tax expires in ${days}d`, color: '#F15A22' });
    }
  });

  if (alerts.length === 0) return null;

  return (
    <div style={{ background: '#1A0A00', border: `1px solid ${C.orange}44`, borderRadius: 10, padding: '12px 16px', marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <BellRing size={14} color={C.orange} />
        <span style={{ fontSize: 12, fontWeight: 700, color: C.orange, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {alerts.length} Alert{alerts.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {alerts.map((a, i) => (
          <div key={i} style={{ background: '#0E0E0E', border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 12px', fontSize: 12 }}>
            <span style={{ color: C.textPrimary, fontWeight: 600 }}>{a.plate}</span>
            <span style={{ color: a.color, marginLeft: 8 }}>{a.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FleetPage() {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'vehicles' | 'trips' | 'issues' | 'maintenance' | 'fuel' | 'documents'>('vehicles');

  const isSuperAdmin = user?.role === 'super_admin';
  const branchFilter = isSuperAdmin ? null : (user?.branch_id || null);

  const tabs: { key: typeof activeTab; label: string; icon: React.ReactNode }[] = [
    { key: 'vehicles', label: 'Vehicles', icon: <Car size={15} /> },
    { key: 'trips', label: 'Trips', icon: <MapPin size={15} /> },
    { key: 'issues', label: 'Issues', icon: <AlertTriangle size={15} /> },
    { key: 'maintenance', label: 'Maintenance', icon: <Wrench size={15} /> },
    { key: 'fuel', label: 'Fuel Log', icon: <Droplets size={15} /> },
    { key: 'documents', label: 'Documents', icon: <FileText size={15} /> },
  ];

  return (
    <div style={{ background: C.bg, color: C.textPrimary, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 10,
            background: `${C.orange}22`,
            border: `1px solid ${C.orange}44`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Truck size={22} color={C.orange} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.textPrimary }}>Fleet Management</h1>
            <p style={{ margin: 0, fontSize: 13, color: C.textSecondary }}>Company vehicles, trips, issues & maintenance</p>
          </div>
        </div>

        <div style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, paddingLeft: 8 }}>
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'none',
                  border: 'none',
                  borderBottom: activeTab === t.key ? `2px solid ${C.orange}` : '2px solid transparent',
                  color: activeTab === t.key ? C.textPrimary : C.textSecondary,
                  fontWeight: activeTab === t.key ? 700 : 400,
                  fontSize: 14,
                  padding: '14px 18px',
                  cursor: 'pointer',
                  transition: 'color 0.15s',
                  marginBottom: -1,
                }}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          <div style={{ padding: 24 }}>
            {activeTab === 'vehicles' && <VehiclesTab branchFilter={branchFilter} isSuperAdmin={isSuperAdmin} />}
            {activeTab === 'trips' && <TripsTab branchFilter={branchFilter} isSuperAdmin={isSuperAdmin} />}
            {activeTab === 'issues' && <IssuesTab branchFilter={branchFilter} isSuperAdmin={isSuperAdmin} />}
            {activeTab === 'maintenance' && <MaintenanceTab branchFilter={branchFilter} isSuperAdmin={isSuperAdmin} />}
            {activeTab === 'fuel' && <FuelLogTab branchFilter={branchFilter} isSuperAdmin={isSuperAdmin} />}
            {activeTab === 'documents' && <DocumentVaultTab branchFilter={branchFilter} isSuperAdmin={isSuperAdmin} />}
          </div>
        </div>
      </div>
    </div>
  );
}
