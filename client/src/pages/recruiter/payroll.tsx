import { useEffect, useState } from 'react'
import { apiCall } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  DollarSign, Users, Calendar, Clock, CheckCircle, Play,
  FileText, Search, Building2, TrendingUp,
  CreditCard, AlertCircle, ArrowRight, Receipt, Globe,
  ExternalLink,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────
interface Employee {
  id: number
  user_id: number
  employee_name: string
  employee_email: string
  employee_number: string
  department: string
  position: string
  employment_type: string
  start_date: string
  status: string
  country_code: string
  currency_code: string
  salary_type: string | null
  salary_amount: number | null
  pay_frequency: string | null
  payment_method: string | null
}

interface PayrollRun {
  id: number
  pay_period_start: string
  pay_period_end: string
  pay_date: string
  status: string
  total_gross: number
  total_net: number
  total_taxes: number
  employee_count: number
  country_code: string | null
  currency_code: string | null
  created_at: string
  processed_at: string | null
}

interface Paycheck {
  id: number
  employee_id: number
  employee_name: string
  employee_number: string
  gross_pay: number
  federal_tax: number
  state_tax: number
  social_security: number
  medicare: number
  other_deductions: number
  net_pay: number
  hours_worked: number | null
  status: string
  pay_date: string
  pay_country: string
  pay_currency: string
  region_deductions: Record<string, number> | string
}

interface DashboardData {
  activeEmployees: number
  employeesByCountry: Record<string, number>
  upcomingPayrolls: PayrollRun[]
  recentPayrolls: PayrollRun[]
  monthlyTotal: number
}

// ── Helpers ────────────────────────────────────────────────
const COUNTRY_INFO: Record<string, { flag: string; name: string; symbol: string; code: string }> = {
  US: { flag: '🇺🇸', name: 'United States', symbol: '$', code: 'USD' },
  IN: { flag: '🇮🇳', name: 'India', symbol: '₹', code: 'INR' },
  GB: { flag: '🇬🇧', name: 'United Kingdom', symbol: '£', code: 'GBP' },
  CA: { flag: '🇨🇦', name: 'Canada', symbol: 'C$', code: 'CAD' },
}

const PAY_FREQ_DEFAULTS: Record<string, string> = {
  US: 'bi-weekly', IN: 'monthly', GB: 'monthly', CA: 'bi-weekly',
}

function getCountry(cc: string) {
  return COUNTRY_INFO[cc] || COUNTRY_INFO.US
}

function fmtCurrency(n: number, cc = 'US') {
  const c = getCountry(cc)
  return c.symbol + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function parseRegionDeductions(rd: Record<string, number> | string): Record<string, number> {
  if (typeof rd === 'string') {
    try { return JSON.parse(rd) } catch { return {} }
  }
  return rd || {}
}

// India deduction labels
const INDIA_LABELS: Record<string, string> = {
  incomeTax: 'Income Tax (TDS)',
  providentFund: 'Provident Fund (EPF 12%)',
  esi: 'ESI',
  professionalTax: 'Professional Tax',
}

// ── Component ──────────────────────────────────────────────
export function RecruiterPayrollPage() {
  const [tab, setTab] = useState('dashboard')
  const [loading, setLoading] = useState(true)
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [search, setSearch] = useState('')
  const [countryFilter, setCountryFilter] = useState('ALL')

  // Run creation
  const [showRunCreate, setShowRunCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [payDate, setPayDate] = useState('')
  const [runCountry, setRunCountry] = useState('ALL')

  // Run detail
  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null)
  const [runPaychecks, setRunPaychecks] = useState<Paycheck[]>([])
  const [loadingRun, setLoadingRun] = useState(false)
  const [processing, setProcessing] = useState(false)

  // Employee config
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  const [savingConfig, setSavingConfig] = useState(false)
  const [cfgSalaryType, setCfgSalaryType] = useState('salary')
  const [cfgSalaryAmount, setCfgSalaryAmount] = useState('')
  const [cfgPayFrequency, setCfgPayFrequency] = useState('bi-weekly')
  const [cfgPaymentMethod, setCfgPaymentMethod] = useState('direct_deposit')
  const [cfgTaxStatus, setCfgTaxStatus] = useState('single')
  const [cfgFederalAllow, setCfgFederalAllow] = useState('0')
  const [cfgStateAllow, setCfgStateAllow] = useState('0')
  const [cfgCountry, setCfgCountry] = useState('US')

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [dashRes, empRes] = await Promise.allSettled([
        apiCall<DashboardData>('/payroll/dashboard'),
        apiCall<{ employees: Employee[] }>('/payroll/employees'),
      ])
      if (dashRes.status === 'fulfilled') setDashboard(dashRes.value)
      if (empRes.status === 'fulfilled') setEmployees(empRes.value.employees || [])
    } catch { /* silent */ }
    finally { setLoading(false) }
  }

  // ── Payroll run CRUD ──
  async function createPayrollRun() {
    if (!periodStart || !periodEnd || !payDate) return
    setCreating(true)
    try {
      await apiCall('/payroll/runs', {
        method: 'POST',
        body: {
          pay_period_start: periodStart,
          pay_period_end: periodEnd,
          pay_date: payDate,
          country_code: runCountry,
        },
      })
      setShowRunCreate(false)
      setPeriodStart(''); setPeriodEnd(''); setPayDate('')
      await loadAll()
      setTab('runs')
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to create payroll run')
    } finally { setCreating(false) }
  }

  async function viewRun(run: PayrollRun) {
    setSelectedRun(run)
    setLoadingRun(true)
    try {
      const res = await apiCall<{ payrollRun: PayrollRun; paychecks: Paycheck[] }>(`/payroll/runs/${run.id}`)
      setRunPaychecks(res.paychecks || [])
      setSelectedRun(res.payrollRun)
    } catch { setRunPaychecks([]) }
    finally { setLoadingRun(false) }
  }

  async function processRun(runId: number) {
    if (!confirm('Process this payroll? This will mark all paychecks as paid.')) return
    setProcessing(true)
    try {
      await apiCall(`/payroll/runs/${runId}/process`, { method: 'POST' })
      setSelectedRun(null)
      await loadAll()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to process payroll')
    } finally { setProcessing(false) }
  }

  // ── Employee config ──
  function openEmployeeConfig(emp: Employee) {
    setSelectedEmployee(emp)
    const cc = emp.country_code || 'US'
    setCfgCountry(cc)
    setCfgSalaryType(emp.salary_type || 'salary')
    setCfgSalaryAmount(String(emp.salary_amount || ''))
    setCfgPayFrequency(emp.pay_frequency || PAY_FREQ_DEFAULTS[cc] || 'bi-weekly')
    setCfgPaymentMethod(emp.payment_method || 'direct_deposit')
    setCfgTaxStatus('single')
    setCfgFederalAllow('0')
    setCfgStateAllow('0')
  }

  async function saveEmployeeConfig() {
    if (!selectedEmployee || !cfgSalaryAmount) return
    setSavingConfig(true)
    try {
      await apiCall(`/payroll/employees/${selectedEmployee.id}/onboard`, {
        method: 'POST',
        body: {
          salary_type: cfgSalaryType,
          salary_amount: Number(cfgSalaryAmount),
          pay_frequency: cfgPayFrequency,
          payment_method: cfgPaymentMethod,
          tax_filing_status: cfgTaxStatus,
          federal_allowances: Number(cfgFederalAllow),
          state_allowances: Number(cfgStateAllow),
          country_code: cfgCountry,
        },
      })
      setSelectedEmployee(null)
      await loadAll()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to save pay config')
    } finally { setSavingConfig(false) }
  }

  // ── Derived data ──
  const filteredEmployees = employees.filter(e => {
    const matchSearch = !search ||
      e.employee_name?.toLowerCase().includes(search.toLowerCase()) ||
      e.employee_email?.toLowerCase().includes(search.toLowerCase()) ||
      e.employee_number?.toLowerCase().includes(search.toLowerCase())
    const matchCountry = countryFilter === 'ALL' || (e.country_code || 'US') === countryFilter
    return matchSearch && matchCountry
  })

  const allRuns = [
    ...(dashboard?.upcomingPayrolls || []),
    ...(dashboard?.recentPayrolls || []),
  ].filter((r, i, arr) => arr.findIndex(x => x.id === r.id) === i)
    .sort((a, b) => new Date(b.pay_date).getTime() - new Date(a.pay_date).getTime())

  // Country badges in the employee list
  const countries = Object.keys(dashboard?.employeesByCountry || {})

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold flex items-center gap-2">
            <Globe className="h-6 w-6 text-primary" /> Global Payroll
          </h1>
          <p className="text-muted-foreground">Manage compensation across US and India with region-aware tax calculations</p>
        </div>
        <Button onClick={() => setShowRunCreate(true)} className="gap-2">
          <Play className="h-4 w-4" /> Run Payroll
        </Button>
      </div>

      {/* Country stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-100 p-2"><Users className="h-5 w-5 text-blue-600" /></div>
              <div>
                <p className="text-2xl font-bold">{dashboard?.activeEmployees || 0}</p>
                <p className="text-xs text-muted-foreground">Total Employees</p>
              </div>
            </div>
            {countries.length > 0 && (
              <div className="mt-2 flex gap-1.5 flex-wrap">
                {countries.map(cc => (
                  <span key={cc} className="inline-flex items-center gap-1 text-xs bg-muted rounded-full px-2 py-0.5">
                    {getCountry(cc).flag} {dashboard?.employeesByCountry?.[cc] || 0}
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-emerald-100 p-2"><DollarSign className="h-5 w-5 text-emerald-600" /></div>
              <div>
                <p className="text-2xl font-bold">{fmtCurrency(dashboard?.monthlyTotal || 0)}</p>
                <p className="text-xs text-muted-foreground">This Month Net</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-amber-100 p-2"><Clock className="h-5 w-5 text-amber-600" /></div>
              <div>
                <p className="text-2xl font-bold">{dashboard?.upcomingPayrolls?.length || 0}</p>
                <p className="text-xs text-muted-foreground">Upcoming Runs</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-purple-100 p-2"><TrendingUp className="h-5 w-5 text-purple-600" /></div>
              <div>
                <p className="text-2xl font-bold">{dashboard?.recentPayrolls?.length || 0}</p>
                <p className="text-xs text-muted-foreground">Completed Runs</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="dashboard">Overview</TabsTrigger>
          <TabsTrigger value="employees">Employees ({employees.length})</TabsTrigger>
          <TabsTrigger value="runs">Payroll Runs</TabsTrigger>
        </TabsList>

        {/* ═══ Overview Tab ═══ */}
        <TabsContent value="dashboard">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardContent className="p-5">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <Calendar className="h-4 w-4 text-amber-500" /> Upcoming Payrolls
                </h3>
                {(dashboard?.upcomingPayrolls || []).length === 0 ? (
                  <div className="text-center py-8">
                    <Calendar className="mx-auto mb-2 h-8 w-8 opacity-20" />
                    <p className="text-sm text-muted-foreground">No upcoming payrolls</p>
                    <Button size="sm" variant="outline" className="mt-3 gap-1" onClick={() => setShowRunCreate(true)}>
                      <Play className="h-3 w-3" /> Schedule Run
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {dashboard!.upcomingPayrolls.map(run => (
                      <div key={run.id} className="flex items-center justify-between rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => viewRun(run)}>
                        <div className="flex items-center gap-2">
                          {run.country_code && <span className="text-sm">{getCountry(run.country_code).flag}</span>}
                          <div>
                            <p className="font-medium text-sm">{new Date(run.pay_period_start).toLocaleDateString()} – {new Date(run.pay_period_end).toLocaleDateString()}</p>
                            <p className="text-xs text-muted-foreground">Pay: {new Date(run.pay_date).toLocaleDateString()} · {run.employee_count || 0} employees</p>
                          </div>
                        </div>
                        <Badge variant={run.status === 'draft' ? 'warning' : 'default'}>{run.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <CheckCircle className="h-4 w-4 text-emerald-500" /> Recent Payrolls
                </h3>
                {(dashboard?.recentPayrolls || []).length === 0 ? (
                  <div className="text-center py-8">
                    <Receipt className="mx-auto mb-2 h-8 w-8 opacity-20" />
                    <p className="text-sm text-muted-foreground">No completed payrolls yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {dashboard!.recentPayrolls.map(run => (
                      <div key={run.id} className="flex items-center justify-between rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => viewRun(run)}>
                        <div className="flex items-center gap-2">
                          {run.country_code && <span className="text-sm">{getCountry(run.country_code).flag}</span>}
                          <div>
                            <p className="font-medium text-sm">{new Date(run.pay_period_start).toLocaleDateString()} – {new Date(run.pay_period_end).toLocaleDateString()}</p>
                            <p className="text-xs text-muted-foreground">Paid {new Date(run.pay_date).toLocaleDateString()} · {fmtCurrency(run.total_net, run.country_code || 'US')} net</p>
                          </div>
                        </div>
                        <Badge variant="success">Completed</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Quick employee list */}
            <Card className="lg:col-span-2">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold flex items-center gap-2"><Users className="h-4 w-4 text-blue-500" /> Employees on Payroll</h3>
                  <Button size="sm" variant="outline" onClick={() => setTab('employees')} className="gap-1">View All <ArrowRight className="h-3 w-3" /></Button>
                </div>
                {employees.length === 0 ? (
                  <div className="text-center py-8">
                    <Users className="mx-auto mb-2 h-8 w-8 opacity-20" />
                    <p className="text-sm text-muted-foreground">No employees yet</p>
                    <p className="text-xs text-muted-foreground mt-1">Employees are created when candidates accept job offers</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="pb-2 font-medium">Employee</th>
                          <th className="pb-2 font-medium">Region</th>
                          <th className="pb-2 font-medium">Position</th>
                          <th className="pb-2 font-medium">Salary</th>
                          <th className="pb-2 font-medium">Frequency</th>
                          <th className="pb-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {employees.slice(0, 6).map(emp => {
                          const cc = emp.country_code || 'US'
                          const ci = getCountry(cc)
                          return (
                            <tr key={emp.id} className="border-b last:border-0 cursor-pointer hover:bg-muted/50" onClick={() => openEmployeeConfig(emp)}>
                              <td className="py-3">
                                <p className="font-medium">{emp.employee_name || 'Unknown'}</p>
                                <p className="text-xs text-muted-foreground">{emp.employee_number}</p>
                              </td>
                              <td className="py-3">
                                <span className="inline-flex items-center gap-1 text-xs bg-muted rounded-full px-2 py-0.5">
                                  {ci.flag} {cc}
                                </span>
                              </td>
                              <td className="py-3">{emp.position || '—'}</td>
                              <td className="py-3 font-medium text-emerald-600">
                                {emp.salary_amount ? fmtCurrency(emp.salary_amount, cc) : '—'}
                                {emp.salary_type === 'hourly' ? '/hr' : '/yr'}
                              </td>
                              <td className="py-3 capitalize">{emp.pay_frequency || '—'}</td>
                              <td className="py-3">
                                {emp.salary_amount ? (
                                  <Badge variant="success" className="gap-1"><CheckCircle className="h-3 w-3" /> Ready</Badge>
                                ) : (
                                  <Badge variant="warning" className="gap-1"><AlertCircle className="h-3 w-3" /> Setup</Badge>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ═══ Employees Tab ═══ */}
        <TabsContent value="employees">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder="Search employees..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
                </div>
                <Select value={countryFilter} onChange={e => setCountryFilter(e.target.value)} className="w-[140px]">
                  <option value="ALL">All Regions</option>
                  <option value="US">🇺🇸 US</option>
                  <option value="IN">🇮🇳 India</option>
                </Select>
                <p className="text-sm text-muted-foreground">{filteredEmployees.length} employees</p>
              </div>

              {filteredEmployees.length === 0 ? (
                <div className="text-center py-12">
                  <Users className="mx-auto mb-3 h-10 w-10 opacity-20" />
                  <p className="text-muted-foreground">
                    {employees.length === 0
                      ? 'No employees yet. Employees are created when candidates accept job offers.'
                      : 'No employees match your filters.'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 font-medium">ID</th>
                        <th className="pb-2 font-medium">Employee</th>
                        <th className="pb-2 font-medium">Region</th>
                        <th className="pb-2 font-medium">Position</th>
                        <th className="pb-2 font-medium">Type</th>
                        <th className="pb-2 font-medium">Compensation</th>
                        <th className="pb-2 font-medium">Pay Cycle</th>
                        <th className="pb-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEmployees.map(emp => {
                        const cc = emp.country_code || 'US'
                        const ci = getCountry(cc)
                        return (
                          <tr key={emp.id} className="border-b last:border-0 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => openEmployeeConfig(emp)}>
                            <td className="py-3 font-mono text-xs">{emp.employee_number}</td>
                            <td className="py-3">
                              <p className="font-medium">{emp.employee_name || 'Unknown'}</p>
                              <p className="text-xs text-muted-foreground">{emp.employee_email}</p>
                            </td>
                            <td className="py-3">
                              <span className="inline-flex items-center gap-1 text-xs bg-muted rounded-full px-2 py-0.5">
                                {ci.flag} {ci.name}
                              </span>
                            </td>
                            <td className="py-3">{emp.position || '—'}</td>
                            <td className="py-3 capitalize">{emp.employment_type || '—'}</td>
                            <td className="py-3">
                              {emp.salary_amount ? (
                                <span className="font-medium text-emerald-600">
                                  {fmtCurrency(emp.salary_amount, cc)}{emp.salary_type === 'hourly' ? '/hr' : '/yr'}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">Not set</span>
                              )}
                            </td>
                            <td className="py-3 capitalize">{emp.pay_frequency || '—'}</td>
                            <td className="py-3">
                              {emp.salary_amount ? (
                                <Badge variant="success" className="gap-1"><CheckCircle className="h-3 w-3" /> Ready</Badge>
                              ) : (
                                <Badge variant="warning" className="gap-1"><AlertCircle className="h-3 w-3" /> Setup</Badge>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ Payroll Runs Tab ═══ */}
        <TabsContent value="runs">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">Payroll Runs</h3>
                <Button size="sm" onClick={() => setShowRunCreate(true)} className="gap-1"><Play className="h-3 w-3" /> New Run</Button>
              </div>
              {allRuns.length === 0 ? (
                <div className="text-center py-12">
                  <Receipt className="mx-auto mb-3 h-10 w-10 opacity-20" />
                  <p className="text-muted-foreground mb-3">No payroll runs yet</p>
                  <Button onClick={() => setShowRunCreate(true)} className="gap-2"><Play className="h-4 w-4" /> Create First Payroll Run</Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {allRuns.map(run => (
                    <div key={run.id} className="flex items-center justify-between rounded-lg border p-4 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => viewRun(run)}>
                      <div className="flex items-center gap-4">
                        <div className={`rounded-lg p-2 ${run.status === 'completed' ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                          {run.status === 'completed' ? <CheckCircle className="h-5 w-5 text-emerald-600" /> : <Clock className="h-5 w-5 text-amber-600" />}
                        </div>
                        <div>
                          <p className="font-medium flex items-center gap-2">
                            {run.country_code && <span className="text-sm">{getCountry(run.country_code).flag}</span>}
                            {new Date(run.pay_period_start).toLocaleDateString()} – {new Date(run.pay_period_end).toLocaleDateString()}
                            {!run.country_code && <span className="text-xs bg-muted rounded-full px-2 py-0.5">All Regions</span>}
                          </p>
                          <p className="text-xs text-muted-foreground">Pay date: {new Date(run.pay_date).toLocaleDateString()} · {run.employee_count || 0} employees</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{fmtCurrency(run.total_net, run.country_code || 'US')}</p>
                        <Badge variant={run.status === 'completed' ? 'success' : run.status === 'draft' ? 'warning' : 'secondary'}>{run.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ═══ Create Payroll Run Dialog ═══ */}
      <Dialog open={showRunCreate} onClose={() => setShowRunCreate(false)} className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Play className="h-5 w-5 text-primary" /> Create Payroll Run</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Create a payroll run with region-aware tax calculations for US and India employees.</p>

          <div>
            <Label>Region</Label>
            <Select value={runCountry} onChange={e => {
              setRunCountry(e.target.value)
              // Auto-set pay frequency based on country
              if (e.target.value === 'IN' && !periodStart) {
                // Suggest monthly dates for India
                const now = new Date()
                const start = new Date(now.getFullYear(), now.getMonth(), 1)
                const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
                setPeriodStart(start.toISOString().split('T')[0])
                setPeriodEnd(end.toISOString().split('T')[0])
                setPayDate(end.toISOString().split('T')[0])
              }
            }} className="mt-1">
              <option value="ALL">🌐 All Regions (US + India)</option>
              <option value="US">🇺🇸 United States (Bi-weekly)</option>
              <option value="IN">🇮🇳 India (Monthly)</option>
            </Select>
          </div>

          <div>
            <Label>Pay Period Start *</Label>
            <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Pay Period End *</Label>
            <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Pay Date *</Label>
            <Input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className="mt-1" />
          </div>

          <div className="rounded-lg bg-muted/50 p-3 space-y-1">
            <p className="text-xs text-muted-foreground">
              <AlertCircle className="h-3 w-3 inline mr-1" />
              {runCountry === 'US' && 'US: Federal income tax + FICA (Social Security & Medicare)'}
              {runCountry === 'IN' && 'India: Income tax slabs + EPF (12%) + ESI + Professional Tax'}
              {runCountry === 'ALL' && 'Mixed: Each employee calculated with their region\'s tax rules'}
            </p>
            <p className="text-xs text-muted-foreground">
              {employees.filter(e => e.salary_amount && (runCountry === 'ALL' || (e.country_code || 'US') === runCountry)).length} configured employees will be included.
              {employees.filter(e => !e.salary_amount).length > 0 && (
                <span className="text-amber-600"> {employees.filter(e => !e.salary_amount).length} need pay setup first.</span>
              )}
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={createPayrollRun} disabled={creating || !periodStart || !periodEnd || !payDate} className="gap-2">
              {creating ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Play className="h-4 w-4" />}
              Create Run
            </Button>
            <Button variant="outline" onClick={() => setShowRunCreate(false)}>Cancel</Button>
          </div>
        </div>
      </Dialog>

      {/* ═══ Payroll Run Detail Dialog ═══ */}
      {selectedRun && (
        <Dialog open={true} onClose={() => { setSelectedRun(null); setRunPaychecks([]) }} className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" /> Payroll Run Detail
              {selectedRun.country_code && <span className="text-sm">{getCountry(selectedRun.country_code).flag}</span>}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Period</p>
                <p className="font-medium text-sm">{new Date(selectedRun.pay_period_start).toLocaleDateString()} – {new Date(selectedRun.pay_period_end).toLocaleDateString()}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Pay Date</p>
                <p className="font-medium text-sm">{new Date(selectedRun.pay_date).toLocaleDateString()}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Gross Total</p>
                <p className="font-medium text-sm">{fmtCurrency(selectedRun.total_gross, selectedRun.country_code || 'US')}</p>
              </div>
              <div className="rounded-lg bg-emerald-50 p-3">
                <p className="text-xs text-muted-foreground">Net Total</p>
                <p className="font-bold text-sm text-emerald-600">{fmtCurrency(selectedRun.total_net, selectedRun.country_code || 'US')}</p>
              </div>
            </div>

            <Badge variant={selectedRun.status === 'completed' ? 'success' : 'warning'} className="gap-1">
              {selectedRun.status === 'completed' ? <CheckCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
              {selectedRun.status}
            </Badge>

            {loadingRun ? (
              <div className="flex justify-center py-8"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
            ) : runPaychecks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No paychecks in this run</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 font-medium">Employee</th>
                      <th className="pb-2 font-medium">Region</th>
                      <th className="pb-2 font-medium text-right">Gross</th>
                      <th className="pb-2 font-medium text-right">Deductions</th>
                      <th className="pb-2 font-medium text-right">Net Pay</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {runPaychecks.map(pc => {
                      const pcc = pc.pay_country || 'US'
                      const ci = getCountry(pcc)
                      const rd = parseRegionDeductions(pc.region_deductions)
                      const deductionTotal = pcc === 'US'
                        ? Number(pc.federal_tax) + Number(pc.state_tax) + Number(pc.social_security) + Number(pc.medicare) + Number(pc.other_deductions)
                        : Number(pc.other_deductions)

                      return (
                        <tr key={pc.id} className="border-b last:border-0 group">
                          <td className="py-2">
                            <p className="font-medium">{pc.employee_name}</p>
                            <p className="text-xs text-muted-foreground">{pc.employee_number}</p>
                          </td>
                          <td className="py-2">
                            <span className="inline-flex items-center gap-1 text-xs bg-muted rounded-full px-2 py-0.5">{ci.flag} {pcc}</span>
                          </td>
                          <td className="py-2 text-right">{fmtCurrency(pc.gross_pay, pcc)}</td>
                          <td className="py-2 text-right">
                            <span className="text-red-600">-{fmtCurrency(deductionTotal, pcc)}</span>
                            {/* Tooltip with breakdown */}
                            <div className="text-[10px] text-muted-foreground space-y-0.5 mt-0.5">
                              {pcc === 'US' ? (
                                <>
                                  <div>Fed: {fmtCurrency(pc.federal_tax, 'US')}</div>
                                  <div>FICA: {fmtCurrency(Number(pc.social_security) + Number(pc.medicare), 'US')}</div>
                                </>
                              ) : pcc === 'IN' ? (
                                <>
                                  {rd.incomeTax ? <div>TDS: {fmtCurrency(rd.incomeTax, 'IN')}</div> : null}
                                  {rd.providentFund ? <div>EPF: {fmtCurrency(rd.providentFund, 'IN')}</div> : null}
                                </>
                              ) : null}
                            </div>
                          </td>
                          <td className="py-2 text-right font-bold text-emerald-600">{fmtCurrency(pc.net_pay, pcc)}</td>
                          <td className="py-2">
                            <Badge variant={pc.status === 'paid' ? 'success' : 'secondary'} className="text-xs">{pc.status}</Badge>
                          </td>
                          <td className="py-2">
                            <a
                              href={`/api/payroll/runs/${selectedRun.id}/payslip/${pc.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                              title="View Payslip"
                            >
                              <FileText className="h-4 w-4 text-muted-foreground hover:text-primary" />
                            </a>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {selectedRun.status === 'draft' && (
              <div className="flex gap-2 pt-2">
                <Button onClick={() => processRun(selectedRun.id)} disabled={processing} className="gap-2">
                  {processing ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <CheckCircle className="h-4 w-4" />}
                  Process Payroll
                </Button>
                <Button variant="outline" onClick={() => { setSelectedRun(null); setRunPaychecks([]) }}>Close</Button>
              </div>
            )}
          </div>
        </Dialog>
      )}

      {/* ═══ Employee Pay Config Dialog ═══ */}
      {selectedEmployee && (
        <Dialog open={true} onClose={() => setSelectedEmployee(null)} className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-primary" /> Pay Configuration</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="font-medium">{selectedEmployee.employee_name}</p>
              <p className="text-xs text-muted-foreground">{selectedEmployee.employee_number} · {selectedEmployee.position || 'No position'}</p>
            </div>

            {/* Country selection */}
            <div>
              <Label>Payroll Region</Label>
              <Select value={cfgCountry} onChange={e => {
                setCfgCountry(e.target.value)
                setCfgPayFrequency(PAY_FREQ_DEFAULTS[e.target.value] || 'bi-weekly')
              }} className="mt-1">
                <option value="US">🇺🇸 United States</option>
                <option value="IN">🇮🇳 India</option>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Salary Type</Label>
                <Select value={cfgSalaryType} onChange={e => setCfgSalaryType(e.target.value)} className="mt-1">
                  <option value="salary">Salary (Annual)</option>
                  <option value="hourly">Hourly</option>
                </Select>
              </div>
              <div>
                <Label>{cfgSalaryType === 'hourly' ? `Hourly Rate (${getCountry(cfgCountry).symbol})` : `Annual Salary (${getCountry(cfgCountry).symbol})`}</Label>
                <Input type="number" value={cfgSalaryAmount} onChange={e => setCfgSalaryAmount(e.target.value)}
                  placeholder={cfgCountry === 'IN' ? (cfgSalaryType === 'hourly' ? '500' : '1200000') : (cfgSalaryType === 'hourly' ? '25.00' : '75000')}
                  className="mt-1" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Pay Frequency</Label>
                <Select value={cfgPayFrequency} onChange={e => setCfgPayFrequency(e.target.value)} className="mt-1">
                  <option value="weekly">Weekly</option>
                  <option value="bi-weekly">Bi-weekly</option>
                  <option value="semi-monthly">Semi-monthly</option>
                  <option value="monthly">Monthly</option>
                </Select>
              </div>
              <div>
                <Label>Payment Method</Label>
                <Select value={cfgPaymentMethod} onChange={e => setCfgPaymentMethod(e.target.value)} className="mt-1">
                  <option value="direct_deposit">{cfgCountry === 'IN' ? 'Bank Transfer (NEFT/IMPS)' : 'Direct Deposit'}</option>
                  <option value="check">{cfgCountry === 'IN' ? 'Cheque' : 'Paper Check'}</option>
                </Select>
              </div>
            </div>

            {/* US-specific tax fields */}
            {cfgCountry === 'US' && (
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>Tax Filing Status</Label>
                  <Select value={cfgTaxStatus} onChange={e => setCfgTaxStatus(e.target.value)} className="mt-1">
                    <option value="single">Single</option>
                    <option value="married">Married</option>
                    <option value="head_of_household">Head of Household</option>
                  </Select>
                </div>
                <div>
                  <Label>Federal Allow.</Label>
                  <Input type="number" min="0" value={cfgFederalAllow} onChange={e => setCfgFederalAllow(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label>State Allow.</Label>
                  <Input type="number" min="0" value={cfgStateAllow} onChange={e => setCfgStateAllow(e.target.value)} className="mt-1" />
                </div>
              </div>
            )}

            {/* India tax info */}
            {cfgCountry === 'IN' && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-1">
                <p className="text-xs font-medium text-amber-800">India Statutory Deductions (Auto-calculated)</p>
                <ul className="text-xs text-amber-700 space-y-0.5">
                  <li>• Income Tax — New regime slabs (FY 2025-26)</li>
                  <li>• EPF — 12% employee contribution</li>
                  <li>• ESI — 0.75% if salary ≤ ₹21,000/month</li>
                  <li>• Professional Tax — ₹200/month</li>
                </ul>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button onClick={saveEmployeeConfig} disabled={savingConfig || !cfgSalaryAmount} className="gap-2">
                {savingConfig ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <CheckCircle className="h-4 w-4" />}
                Save Configuration
              </Button>
              <Button variant="outline" onClick={() => setSelectedEmployee(null)}>Cancel</Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}
