import { useEffect, useState } from 'react'
import { apiCall } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DollarSign, Calendar, CheckCircle, Clock,
  FileText, Receipt, TrendingUp, Building2,
  CreditCard, AlertCircle, Wallet,
} from 'lucide-react'

interface EmployeeProfile {
  id: number
  employee_number: string
  position: string
  department: string
  employment_type: string
  start_date: string
  salary_type: string
  salary_amount: number
  pay_frequency: string
  payment_method: string
  bank_name: string | null
  bank_account_last4: string | null
  employer_name: string
}

interface PaycheckItem {
  id: number
  pay_period_start: string
  pay_period_end: string
  pay_date: string
  hours_worked: number | null
  gross_pay: number
  federal_tax: number
  state_tax: number
  social_security: number
  medicare: number
  other_deductions: number
  net_pay: number
  status: string
  payroll_status: string
}

const fmt = (n: number) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function CandidatePayrollPage() {
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<EmployeeProfile | null>(null)
  const [paychecks, setPaychecks] = useState<PaycheckItem[]>([])
  const [selectedPaycheck, setSelectedPaycheck] = useState<PaycheckItem | null>(null)
  const [noProfile, setNoProfile] = useState(false)
  const [showBank, setShowBank] = useState(false)
  const [savingBank, setSavingBank] = useState(false)
  const [bankName, setBankName] = useState('')
  const [bankLast4, setBankLast4] = useState('')
  const [bankRouting, setBankRouting] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [profRes, checkRes] = await Promise.allSettled([
        apiCall<{ profile: EmployeeProfile }>('/payroll/employee/profile'),
        apiCall<{ paychecks: PaycheckItem[] }>('/payroll/employee/paychecks'),
      ])

      if (profRes.status === 'fulfilled') {
        setProfile(profRes.value.profile)
        setNoProfile(false)
      } else {
        setNoProfile(true)
      }

      if (checkRes.status === 'fulfilled') {
        setPaychecks(checkRes.value.paychecks || [])
      }
    } catch {
      setNoProfile(true)
    } finally {
      setLoading(false)
    }
  }

  async function saveBankAccount() {
    if (!bankName || !bankLast4) return
    setSavingBank(true)
    try {
      await apiCall('/payroll/employee/bank-account', {
        method: 'POST',
        body: {
          bank_name: bankName,
          bank_account_last4: bankLast4,
          bank_routing_number: bankRouting,
        },
      })
      setShowBank(false)
      await loadData()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update bank account')
    } finally {
      setSavingBank(false)
    }
  }

  // Calculate YTD
  const currentYear = new Date().getFullYear()
  const ytdPaychecks = paychecks.filter(p =>
    new Date(p.pay_date).getFullYear() === currentYear && p.status === 'paid'
  )
  const ytdGross = ytdPaychecks.reduce((sum, p) => sum + Number(p.gross_pay), 0)
  const ytdNet = ytdPaychecks.reduce((sum, p) => sum + Number(p.net_pay), 0)
  const ytdTaxes = ytdPaychecks.reduce((sum, p) =>
    sum + Number(p.federal_tax) + Number(p.state_tax) + Number(p.social_security) + Number(p.medicare), 0
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (noProfile) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-2xl font-bold">Pay & Compensation</h1>
          <p className="text-muted-foreground">View your pay stubs and earnings</p>
        </div>
        <Card>
          <CardContent className="py-16 text-center">
            <Wallet className="mx-auto mb-3 h-12 w-12 opacity-20" />
            <h3 className="font-semibold text-lg mb-2">No Payroll Profile Yet</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Your payroll profile will be set up once you've been onboarded as an employee.
              Accept a job offer and complete onboarding to get started.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Pay & Compensation</h1>
          <p className="text-muted-foreground">View your pay stubs, earnings, and direct deposit</p>
        </div>
      </div>

      {/* YTD Summary */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-emerald-100 p-2">
                <DollarSign className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-emerald-600">{fmt(ytdNet)}</p>
                <p className="text-xs text-muted-foreground">YTD Net Pay</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-100 p-2">
                <TrendingUp className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{fmt(ytdGross)}</p>
                <p className="text-xs text-muted-foreground">YTD Gross</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-red-100 p-2">
                <Receipt className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{fmt(ytdTaxes)}</p>
                <p className="text-xs text-muted-foreground">YTD Taxes</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-purple-100 p-2">
                <FileText className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{ytdPaychecks.length}</p>
                <p className="text-xs text-muted-foreground">Pay Stubs</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Profile Summary */}
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold flex items-center gap-2 mb-4">
              <Building2 className="h-4 w-4 text-blue-500" /> Employment Details
            </h3>
            {profile && (
              <div className="space-y-3">
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Employee ID</p>
                  <p className="font-mono font-medium">{profile.employee_number}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Position</p>
                  <p className="font-medium">{profile.position || 'Not set'}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Compensation</p>
                  <p className="font-medium text-emerald-600">
                    {fmt(profile.salary_amount)}{profile.salary_type === 'hourly' ? '/hr' : '/yr'}
                  </p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {profile.pay_frequency} · {(profile.payment_method || '').replace(/_/g, ' ')}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Direct Deposit</p>
                  {profile.bank_name ? (
                    <div>
                      <p className="font-medium">{profile.bank_name}</p>
                      <p className="text-xs text-muted-foreground">Account ending in {profile.bank_account_last4}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-amber-600">Not configured</p>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 gap-1"
                    onClick={() => {
                      setBankName(profile.bank_name || '')
                      setBankLast4(profile.bank_account_last4 || '')
                      setBankRouting('')
                      setShowBank(true)
                    }}
                  >
                    <CreditCard className="h-3 w-3" />
                    {profile.bank_name ? 'Update' : 'Set Up'}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pay Stubs */}
        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <h3 className="font-semibold flex items-center gap-2 mb-4">
              <Receipt className="h-4 w-4 text-emerald-500" /> Pay Stubs
            </h3>
            {paychecks.length === 0 ? (
              <div className="text-center py-12">
                <Receipt className="mx-auto mb-3 h-10 w-10 opacity-20" />
                <p className="text-muted-foreground">No pay stubs yet</p>
                <p className="text-xs text-muted-foreground mt-1">Pay stubs will appear here after payroll is processed</p>
              </div>
            ) : (
              <div className="space-y-2">
                {paychecks.map(pc => (
                  <div
                    key={pc.id}
                    className="flex items-center justify-between rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setSelectedPaycheck(pc)}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`rounded-lg p-2 ${pc.status === 'paid' ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                        {pc.status === 'paid'
                          ? <CheckCircle className="h-4 w-4 text-emerald-600" />
                          : <Clock className="h-4 w-4 text-amber-600" />
                        }
                      </div>
                      <div>
                        <p className="font-medium text-sm">
                          {new Date(pc.pay_period_start).toLocaleDateString()} – {new Date(pc.pay_period_end).toLocaleDateString()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Pay date: {new Date(pc.pay_date).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-emerald-600">{fmt(pc.net_pay)}</p>
                      <Badge variant={pc.status === 'paid' ? 'success' : 'secondary'} className="text-xs">
                        {pc.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pay Stub Detail Dialog */}
      {selectedPaycheck && (
        <Dialog open={true} onClose={() => setSelectedPaycheck(null)} className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" /> Pay Stub
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Header */}
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-sm text-muted-foreground">Pay Period</p>
              <p className="font-semibold">
                {new Date(selectedPaycheck.pay_period_start).toLocaleDateString()} – {new Date(selectedPaycheck.pay_period_end).toLocaleDateString()}
              </p>
              <p className="text-xs text-muted-foreground">
                Pay date: {new Date(selectedPaycheck.pay_date).toLocaleDateString()}
              </p>
            </div>

            {/* Earnings */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Earnings</p>
              <div className="rounded-lg border p-3 space-y-2">
                {selectedPaycheck.hours_worked && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Hours Worked</span>
                    <span>{selectedPaycheck.hours_worked}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-medium">
                  <span>Gross Pay</span>
                  <span>{fmt(selectedPaycheck.gross_pay)}</span>
                </div>
              </div>
            </div>

            {/* Deductions */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Deductions</p>
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Federal Income Tax</span>
                  <span className="text-red-600">-{fmt(selectedPaycheck.federal_tax)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">State Income Tax</span>
                  <span className="text-red-600">-{fmt(selectedPaycheck.state_tax)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Social Security</span>
                  <span className="text-red-600">-{fmt(selectedPaycheck.social_security)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Medicare</span>
                  <span className="text-red-600">-{fmt(selectedPaycheck.medicare)}</span>
                </div>
                {Number(selectedPaycheck.other_deductions) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Other Deductions</span>
                    <span className="text-red-600">-{fmt(selectedPaycheck.other_deductions)}</span>
                  </div>
                )}
                <div className="border-t pt-2 flex justify-between text-sm font-medium">
                  <span>Total Deductions</span>
                  <span className="text-red-600">
                    -{fmt(
                      Number(selectedPaycheck.federal_tax) +
                      Number(selectedPaycheck.state_tax) +
                      Number(selectedPaycheck.social_security) +
                      Number(selectedPaycheck.medicare) +
                      Number(selectedPaycheck.other_deductions)
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Net Pay */}
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-center">
              <p className="text-xs text-emerald-700 mb-1">Net Pay</p>
              <p className="text-3xl font-bold text-emerald-600">{fmt(selectedPaycheck.net_pay)}</p>
            </div>

            <Badge variant={selectedPaycheck.status === 'paid' ? 'success' : 'secondary'} className="gap-1">
              {selectedPaycheck.status === 'paid' ? <CheckCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
              {selectedPaycheck.status}
            </Badge>
          </div>
        </Dialog>
      )}

      {/* Bank Account Dialog */}
      <Dialog open={showBank} onClose={() => setShowBank(false)} className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" /> Direct Deposit
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Update your bank account information for direct deposit payments.
          </p>
          <div>
            <Label>Bank Name *</Label>
            <Input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="e.g. Chase Bank" className="mt-1" />
          </div>
          <div>
            <Label>Account Last 4 Digits *</Label>
            <Input value={bankLast4} onChange={e => setBankLast4(e.target.value.slice(0, 4))} placeholder="1234" maxLength={4} className="mt-1" />
          </div>
          <div>
            <Label>Routing Number</Label>
            <Input value={bankRouting} onChange={e => setBankRouting(e.target.value)} placeholder="021000021" className="mt-1" />
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={saveBankAccount} disabled={savingBank || !bankName || !bankLast4} className="gap-2">
              {savingBank ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
              Save
            </Button>
            <Button variant="outline" onClick={() => setShowBank(false)}>Cancel</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
