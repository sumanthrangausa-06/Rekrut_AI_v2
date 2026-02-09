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
  FileText, Search, Building2, Briefcase, TrendingUp,
  CreditCard, AlertCircle, ArrowRight, Receipt,
} from 'lucide-react'

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
}

interface DashboardData {
  activeEmployees: number
  upcomingPayrolls: PayrollRun[]
  recentPayrolls: PayrollRun[]
  monthlyTotal: number
}

const fmt = (n: number) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function RecruiterPayrollPage() {
  const [tab, setTab] = useState('dashboard')
  const [loading, setLoading] = useState(true)
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [search, setSearch] = useState('')
  const [showRunCreate, setShowRunCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null)
  const [runPaychecks, setRunPaychecks] = useState<Paycheck[]>([])
  const [loadingRun, setLoadingRun] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  const [savingConfig, setSavingConfig] = useState(false)

  // Run form
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [payDate, setPayDate] = useState('')

  // Employee config form
  const [cfgSalaryType, setCfgSalaryType] = useState('salary')
  const [cfgSalaryAmount, setCfgSalaryAmount] = useState('')
  const [cfgPayFrequency, setCfgPayFrequency] = useState('bi-weekly')
  const [cfgPaymentMethod, setCfgPaymentMethod] = useState('direct_deposit')
  const [cfgTaxStatus, setCfgTaxStatus] = useState('single')
  const [cfgFederalAllow, setCfgFederalAllow] = useState('0')
  const [cfgStateAllow, setCfgStateAllow] = useState('0')

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [dashRes, empRes] = await Promise.allSettled([
        apiCall<DashboardData>('/payroll/dashboard'),
        apiCall<{ employees: Employee[] }>('/payroll/employees'),
      ])
      if (dashRes.status === 'fulfilled') setDashboard(dashRes.value)
      if (empRes.status === 'fulfilled') setEmployees(empRes.value.employees || [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  async function createPayrollRun() {
    if (!periodStart || !periodEnd || !payDate) return
    setCreating(true)
    try {
      await apiCall('/payroll/runs', {
        method: 'POST',
        body: { pay_period_start: periodStart, pay_period_end: periodEnd, pay_date: payDate },
      })
      setShowRunCreate(false)
      setPeriodStart('')
      setPeriodEnd('')
      setPayDate('')
      await loadAll()
      setTab('runs')
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to create payroll run')
    } finally {
      setCreating(false)
    }
  }

  async function viewRun(run: PayrollRun) {
    setSelectedRun(run)
    setLoadingRun(true)
    try {
      const res = await apiCall<{ payrollRun: PayrollRun; paychecks: Paycheck[] }>(`/payroll/runs/${run.id}`)
      setRunPaychecks(res.paychecks || [])
      setSelectedRun(res.payrollRun)
    } catch {
      setRunPaychecks([])
    } finally {
      setLoadingRun(false)
    }
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
    } finally {
      setProcessing(false)
    }
  }

  function openEmployeeConfig(emp: Employee) {
    setSelectedEmployee(emp)
    setCfgSalaryType(emp.salary_type || 'salary')
    setCfgSalaryAmount(String(emp.salary_amount || ''))
    setCfgPayFrequency(emp.pay_frequency || 'bi-weekly')
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
        },
      })
      setSelectedEmployee(null)
      await loadAll()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to save pay config')
    } finally {
      setSavingConfig(false)
    }
  }

  const filteredEmployees = employees.filter(e =>
    !search ||
    e.employee_name?.toLowerCase().includes(search.toLowerCase()) ||
    e.employee_email?.toLowerCase().includes(search.toLowerCase()) ||
    e.employee_number?.toLowerCase().includes(search.toLowerCase())
  )

  const allRuns = [
    ...(dashboard?.upcomingPayrolls || []),
    ...(dashboard?.recentPayrolls || []),
  ].filter((r, i, arr) => arr.findIndex(x => x.id === r.id) === i)
    .sort((a, b) => new Date(b.pay_date).getTime() - new Date(a.pay_date).getTime())

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Payroll</h1>
          <p className="text-muted-foreground">Manage employee compensation, run payroll, and generate pay stubs</p>
        </div>
        <Button onClick={() => setShowRunCreate(true)} className="gap-2">
          <Play className="h-4 w-4" /> Run Payroll
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-100 p-2">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{dashboard?.activeEmployees || 0}</p>
                <p className="text-xs text-muted-foreground">Active Employees</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-emerald-100 p-2">
                <DollarSign className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{fmt(dashboard?.monthlyTotal || 0)}</p>
                <p className="text-xs text-muted-foreground">This Month</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-amber-100 p-2">
                <Clock className="h-5 w-5 text-amber-600" />
              </div>
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
              <div className="rounded-lg bg-purple-100 p-2">
                <TrendingUp className="h-5 w-5 text-purple-600" />
              </div>
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

        {/* Overview Tab */}
        <TabsContent value="dashboard">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Upcoming payrolls */}
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-amber-500" /> Upcoming Payrolls
                  </h3>
                </div>
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
                      <div
                        key={run.id}
                        className="flex items-center justify-between rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => viewRun(run)}
                      >
                        <div>
                          <p className="font-medium text-sm">
                            {new Date(run.pay_period_start).toLocaleDateString()} – {new Date(run.pay_period_end).toLocaleDateString()}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Pay date: {new Date(run.pay_date).toLocaleDateString()} · {run.employee_count || 0} employees
                          </p>
                        </div>
                        <Badge variant={run.status === 'draft' ? 'warning' : 'default'}>
                          {run.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent payrolls */}
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-emerald-500" /> Recent Payrolls
                  </h3>
                </div>
                {(dashboard?.recentPayrolls || []).length === 0 ? (
                  <div className="text-center py-8">
                    <Receipt className="mx-auto mb-2 h-8 w-8 opacity-20" />
                    <p className="text-sm text-muted-foreground">No completed payrolls yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {dashboard!.recentPayrolls.map(run => (
                      <div
                        key={run.id}
                        className="flex items-center justify-between rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => viewRun(run)}
                      >
                        <div>
                          <p className="font-medium text-sm">
                            {new Date(run.pay_period_start).toLocaleDateString()} – {new Date(run.pay_period_end).toLocaleDateString()}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Paid {new Date(run.pay_date).toLocaleDateString()} · {fmt(run.total_net)} net
                          </p>
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
                  <h3 className="font-semibold flex items-center gap-2">
                    <Users className="h-4 w-4 text-blue-500" /> Employees on Payroll
                  </h3>
                  <Button size="sm" variant="outline" onClick={() => setTab('employees')} className="gap-1">
                    View All <ArrowRight className="h-3 w-3" />
                  </Button>
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
                          <th className="pb-2 font-medium">Position</th>
                          <th className="pb-2 font-medium">Salary</th>
                          <th className="pb-2 font-medium">Frequency</th>
                          <th className="pb-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {employees.slice(0, 5).map(emp => (
                          <tr key={emp.id} className="border-b last:border-0 cursor-pointer hover:bg-muted/50" onClick={() => openEmployeeConfig(emp)}>
                            <td className="py-3">
                              <p className="font-medium">{emp.employee_name || 'Unknown'}</p>
                              <p className="text-xs text-muted-foreground">{emp.employee_number}</p>
                            </td>
                            <td className="py-3">{emp.position || '—'}</td>
                            <td className="py-3 font-medium text-emerald-600">
                              {emp.salary_amount ? fmt(emp.salary_amount) : '—'}
                              {emp.salary_type === 'hourly' ? '/hr' : '/yr'}
                            </td>
                            <td className="py-3 capitalize">{emp.pay_frequency || '—'}</td>
                            <td className="py-3">
                              {emp.salary_amount ? (
                                <Badge variant="success" className="gap-1">
                                  <CheckCircle className="h-3 w-3" /> Configured
                                </Badge>
                              ) : (
                                <Badge variant="warning" className="gap-1">
                                  <AlertCircle className="h-3 w-3" /> Needs Setup
                                </Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Employees Tab */}
        <TabsContent value="employees">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search employees..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <p className="text-sm text-muted-foreground">{filteredEmployees.length} employees</p>
              </div>

              {filteredEmployees.length === 0 ? (
                <div className="text-center py-12">
                  <Users className="mx-auto mb-3 h-10 w-10 opacity-20" />
                  <p className="text-muted-foreground">
                    {employees.length === 0
                      ? 'No employees yet. Employees are created when candidates accept job offers.'
                      : 'No employees match your search.'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 font-medium">ID</th>
                        <th className="pb-2 font-medium">Employee</th>
                        <th className="pb-2 font-medium">Position</th>
                        <th className="pb-2 font-medium">Type</th>
                        <th className="pb-2 font-medium">Compensation</th>
                        <th className="pb-2 font-medium">Pay Frequency</th>
                        <th className="pb-2 font-medium">Payment Method</th>
                        <th className="pb-2 font-medium">Pay Config</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEmployees.map(emp => (
                        <tr
                          key={emp.id}
                          className="border-b last:border-0 cursor-pointer hover:bg-muted/50 transition-colors"
                          onClick={() => openEmployeeConfig(emp)}
                        >
                          <td className="py-3 font-mono text-xs">{emp.employee_number}</td>
                          <td className="py-3">
                            <p className="font-medium">{emp.employee_name || 'Unknown'}</p>
                            <p className="text-xs text-muted-foreground">{emp.employee_email}</p>
                          </td>
                          <td className="py-3">{emp.position || '—'}</td>
                          <td className="py-3 capitalize">{emp.employment_type || '—'}</td>
                          <td className="py-3">
                            {emp.salary_amount ? (
                              <span className="font-medium text-emerald-600">
                                {fmt(emp.salary_amount)}{emp.salary_type === 'hourly' ? '/hr' : '/yr'}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Not set</span>
                            )}
                          </td>
                          <td className="py-3 capitalize">{emp.pay_frequency || '—'}</td>
                          <td className="py-3 capitalize">{(emp.payment_method || '—').replace(/_/g, ' ')}</td>
                          <td className="py-3">
                            {emp.salary_amount ? (
                              <Badge variant="success" className="gap-1">
                                <CheckCircle className="h-3 w-3" /> Ready
                              </Badge>
                            ) : (
                              <Badge variant="warning" className="gap-1">
                                <AlertCircle className="h-3 w-3" /> Setup
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Payroll Runs Tab */}
        <TabsContent value="runs">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">Payroll Runs</h3>
                <Button size="sm" onClick={() => setShowRunCreate(true)} className="gap-1">
                  <Play className="h-3 w-3" /> New Run
                </Button>
              </div>

              {allRuns.length === 0 ? (
                <div className="text-center py-12">
                  <Receipt className="mx-auto mb-3 h-10 w-10 opacity-20" />
                  <p className="text-muted-foreground mb-3">No payroll runs yet</p>
                  <Button onClick={() => setShowRunCreate(true)} className="gap-2">
                    <Play className="h-4 w-4" /> Create First Payroll Run
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {allRuns.map(run => (
                    <div
                      key={run.id}
                      className="flex items-center justify-between rounded-lg border p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => viewRun(run)}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`rounded-lg p-2 ${run.status === 'completed' ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                          {run.status === 'completed'
                            ? <CheckCircle className="h-5 w-5 text-emerald-600" />
                            : <Clock className="h-5 w-5 text-amber-600" />
                          }
                        </div>
                        <div>
                          <p className="font-medium">
                            {new Date(run.pay_period_start).toLocaleDateString()} – {new Date(run.pay_period_end).toLocaleDateString()}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Pay date: {new Date(run.pay_date).toLocaleDateString()} · {run.employee_count || 0} employees
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{fmt(run.total_net)}</p>
                        <Badge variant={run.status === 'completed' ? 'success' : run.status === 'draft' ? 'warning' : 'secondary'}>
                          {run.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Payroll Run Dialog */}
      <Dialog open={showRunCreate} onClose={() => setShowRunCreate(false)} className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-5 w-5 text-primary" /> Create Payroll Run
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Create a payroll run to calculate paychecks for all configured employees.
          </p>
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
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground">
              <AlertCircle className="h-3 w-3 inline mr-1" />
              Paychecks will be auto-calculated for {employees.filter(e => e.salary_amount).length} configured employees.
              {employees.filter(e => !e.salary_amount).length > 0 && (
                <span className="text-amber-600"> {employees.filter(e => !e.salary_amount).length} employees need pay setup first.</span>
              )}
            </p>
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={createPayrollRun} disabled={creating || !periodStart || !periodEnd || !payDate} className="gap-2">
              {creating ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Create Run
            </Button>
            <Button variant="outline" onClick={() => setShowRunCreate(false)}>Cancel</Button>
          </div>
        </div>
      </Dialog>

      {/* Payroll Run Detail Dialog */}
      {selectedRun && (
        <Dialog open={true} onClose={() => { setSelectedRun(null); setRunPaychecks([]) }} className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" /> Payroll Run Detail
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Run summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Period</p>
                <p className="font-medium text-sm">
                  {new Date(selectedRun.pay_period_start).toLocaleDateString()} – {new Date(selectedRun.pay_period_end).toLocaleDateString()}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Pay Date</p>
                <p className="font-medium text-sm">{new Date(selectedRun.pay_date).toLocaleDateString()}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Gross Total</p>
                <p className="font-medium text-sm">{fmt(selectedRun.total_gross)}</p>
              </div>
              <div className="rounded-lg bg-emerald-50 p-3">
                <p className="text-xs text-muted-foreground">Net Total</p>
                <p className="font-bold text-sm text-emerald-600">{fmt(selectedRun.total_net)}</p>
              </div>
            </div>

            <Badge variant={selectedRun.status === 'completed' ? 'success' : 'warning'} className="gap-1">
              {selectedRun.status === 'completed' ? <CheckCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
              {selectedRun.status}
            </Badge>

            {/* Paychecks table */}
            {loadingRun ? (
              <div className="flex justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : runPaychecks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No paychecks in this run</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 font-medium">Employee</th>
                      <th className="pb-2 font-medium text-right">Gross</th>
                      <th className="pb-2 font-medium text-right">Fed Tax</th>
                      <th className="pb-2 font-medium text-right">State Tax</th>
                      <th className="pb-2 font-medium text-right">SS</th>
                      <th className="pb-2 font-medium text-right">Medicare</th>
                      <th className="pb-2 font-medium text-right">Net Pay</th>
                      <th className="pb-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runPaychecks.map(pc => (
                      <tr key={pc.id} className="border-b last:border-0">
                        <td className="py-2">
                          <p className="font-medium">{pc.employee_name}</p>
                          <p className="text-xs text-muted-foreground">{pc.employee_number}</p>
                        </td>
                        <td className="py-2 text-right">{fmt(pc.gross_pay)}</td>
                        <td className="py-2 text-right text-red-600">{fmt(pc.federal_tax)}</td>
                        <td className="py-2 text-right text-red-600">{fmt(pc.state_tax)}</td>
                        <td className="py-2 text-right text-red-600">{fmt(pc.social_security)}</td>
                        <td className="py-2 text-right text-red-600">{fmt(pc.medicare)}</td>
                        <td className="py-2 text-right font-bold text-emerald-600">{fmt(pc.net_pay)}</td>
                        <td className="py-2">
                          <Badge variant={pc.status === 'paid' ? 'success' : 'secondary'} className="text-xs">
                            {pc.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Process button for draft runs */}
            {selectedRun.status === 'draft' && (
              <div className="flex gap-2 pt-2">
                <Button onClick={() => processRun(selectedRun.id)} disabled={processing} className="gap-2">
                  {processing ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    <CheckCircle className="h-4 w-4" />
                  )}
                  Process Payroll
                </Button>
                <Button variant="outline" onClick={() => { setSelectedRun(null); setRunPaychecks([]) }}>Close</Button>
              </div>
            )}
          </div>
        </Dialog>
      )}

      {/* Employee Pay Config Dialog */}
      {selectedEmployee && (
        <Dialog open={true} onClose={() => setSelectedEmployee(null)} className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-primary" /> Pay Configuration
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="font-medium">{selectedEmployee.employee_name}</p>
              <p className="text-xs text-muted-foreground">{selectedEmployee.employee_number} · {selectedEmployee.position || 'No position'}</p>
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
                <Label>{cfgSalaryType === 'hourly' ? 'Hourly Rate ($)' : 'Annual Salary ($)'}</Label>
                <Input
                  type="number"
                  value={cfgSalaryAmount}
                  onChange={e => setCfgSalaryAmount(e.target.value)}
                  placeholder={cfgSalaryType === 'hourly' ? '25.00' : '75000'}
                  className="mt-1"
                />
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
                  <option value="direct_deposit">Direct Deposit</option>
                  <option value="check">Paper Check</option>
                </Select>
              </div>
            </div>

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

            <div className="flex gap-2 pt-2">
              <Button onClick={saveEmployeeConfig} disabled={savingConfig || !cfgSalaryAmount} className="gap-2">
                {savingConfig ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <CheckCircle className="h-4 w-4" />
                )}
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
