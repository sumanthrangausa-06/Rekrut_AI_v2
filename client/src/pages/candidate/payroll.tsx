import { useEffect, useState } from 'react'
import { apiCall } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DollarSign, Clock, CheckCircle, FileText,
  CreditCard, Landmark, Receipt, Calendar, TrendingDown,
  ExternalLink,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────
interface PayrollProfile {
  employee_number: string
  position: string
  department: string
  start_date: string
  salary_type: string
  salary_amount: number
  pay_frequency: string
  payment_method: string
  bank_name: string | null
  bank_account_last4: string | null
  employer_name: string
  pay_country: string
  pay_currency: string
}

interface Paycheck {
  id: number
  payroll_run_id: number
  gross_pay: number
  federal_tax: number
  state_tax: number
  social_security: number
  medicare: number
  other_deductions: number
  net_pay: number
  hours_worked: number | null
  pay_date: string
  pay_period_start: string
  pay_period_end: string
  status: string
  payroll_status: string
  pay_country: string
  pay_currency: string
  region_deductions: Record<string, number> | string
}

// ── Helpers ────────────────────────────────────────────────
const COUNTRY_INFO: Record<string, { flag: string; name: string; symbol: string }> = {
  US: { flag: '🇺🇸', name: 'United States', symbol: '$' },
  IN: { flag: '🇮🇳', name: 'India', symbol: '₹' },
  GB: { flag: '🇬🇧', name: 'United Kingdom', symbol: '£' },
  CA: { flag: '🇨🇦', name: 'Canada', symbol: 'C$' },
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

const INDIA_LABELS: Record<string, string> = {
  incomeTax: 'Income Tax (TDS)',
  providentFund: 'Provident Fund (EPF)',
  esi: 'ESI',
  professionalTax: 'Professional Tax',
}

// ── Component ──────────────────────────────────────────────
export function CandidatePayrollPage() {
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<PayrollProfile | null>(null)
  const [paychecks, setPaychecks] = useState<Paycheck[]>([])
  const [selectedPaycheck, setSelectedPaycheck] = useState<Paycheck | null>(null)
  const [noProfile, setNoProfile] = useState(false)

  // Bank update
  const [showBankEdit, setShowBankEdit] = useState(false)
  const [bankName, setBankName] = useState('')
  const [bankLast4, setBankLast4] = useState('')
  const [bankRouting, setBankRouting] = useState('')
  const [savingBank, setSavingBank] = useState(false)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [profileRes, checksRes] = await Promise.allSettled([
        apiCall<{ profile: PayrollProfile }>('/payroll/employee/profile'),
        apiCall<{ paychecks: Paycheck[] }>('/payroll/employee/paychecks'),
      ])

      if (profileRes.status === 'fulfilled') {
        setProfile(profileRes.value.profile)
      } else {
        setNoProfile(true)
      }

      if (checksRes.status === 'fulfilled') {
        setPaychecks(checksRes.value.paychecks || [])
      }
    } catch { setNoProfile(true) }
    finally { setLoading(false) }
  }

  async function saveBankDetails() {
    setSavingBank(true)
    try {
      await apiCall('/payroll/employee/bank-account', {
        method: 'POST',
        body: { bank_name: bankName, bank_account_last4: bankLast4, bank_routing_number: bankRouting },
      })
      setShowBankEdit(false)
      await loadAll()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update bank details')
    } finally { setSavingBank(false) }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (noProfile) {
    return (
      <div className="text-center py-20 space-y-3">
        <DollarSign className="mx-auto h-12 w-12 opacity-20" />
        <h2 className="text-xl font-semibold">Payroll Not Set Up</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Your payroll profile hasn't been created yet. This happens automatically once your employer accepts you and configures your compensation.
        </p>
      </div>
    )
  }

  const cc = profile?.pay_country || 'US'
  const ci = getCountry(cc)

  // YTD calculations
  const currentYear = new Date().getFullYear()
  const ytdPaychecks = paychecks.filter(p => new Date(p.pay_date).getFullYear() === currentYear)
  const ytdGross = ytdPaychecks.reduce((sum, p) => sum + Number(p.gross_pay), 0)
  const ytdNet = ytdPaychecks.reduce((sum, p) => sum + Number(p.net_pay), 0)
  const ytdDeductions = ytdGross - ytdNet

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-bold flex items-center gap-2">
          <DollarSign className="h-6 w-6 text-primary" /> My Payroll
        </h1>
        <p className="text-muted-foreground flex items-center gap-1.5">
          View your compensation, pay stubs, and tax information
          <span className="inline-flex items-center gap-1 text-xs bg-muted rounded-full px-2 py-0.5">{ci.flag} {ci.name}</span>
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-100 p-2"><DollarSign className="h-5 w-5 text-blue-600" /></div>
              <div>
                <p className="text-2xl font-bold">{profile?.salary_amount ? fmtCurrency(profile.salary_amount, cc) : '—'}</p>
                <p className="text-xs text-muted-foreground">{profile?.salary_type === 'hourly' ? 'Hourly Rate' : 'Annual Salary'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-emerald-100 p-2"><TrendingDown className="h-5 w-5 text-emerald-600" /></div>
              <div>
                <p className="text-2xl font-bold">{fmtCurrency(ytdNet, cc)}</p>
                <p className="text-xs text-muted-foreground">YTD Net Pay</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-amber-100 p-2"><Receipt className="h-5 w-5 text-amber-600" /></div>
              <div>
                <p className="text-2xl font-bold">{fmtCurrency(ytdDeductions, cc)}</p>
                <p className="text-xs text-muted-foreground">YTD Deductions</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-purple-100 p-2"><Calendar className="h-5 w-5 text-purple-600" /></div>
              <div>
                <p className="text-2xl font-bold capitalize">{profile?.pay_frequency || '—'}</p>
                <p className="text-xs text-muted-foreground">Pay Cycle</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Profile info */}
        <Card>
          <CardContent className="p-5 space-y-4">
            <h3 className="font-semibold flex items-center gap-2"><CreditCard className="h-4 w-4 text-primary" /> Pay Profile</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Employee ID</span><span className="font-medium">{profile?.employee_number}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Position</span><span className="font-medium">{profile?.position || '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Region</span><span className="font-medium">{ci.flag} {ci.name}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Pay Cycle</span><span className="font-medium capitalize">{profile?.pay_frequency || '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Payment</span><span className="font-medium capitalize">{(profile?.payment_method || '—').replace('_', ' ')}</span></div>
              {profile?.bank_name && (
                <div className="flex justify-between"><span className="text-muted-foreground">Bank</span><span className="font-medium">{profile.bank_name} ····{profile.bank_account_last4}</span></div>
              )}
            </div>
            <Button size="sm" variant="outline" onClick={() => {
              setShowBankEdit(true)
              setBankName(profile?.bank_name || '')
              setBankLast4(profile?.bank_account_last4 || '')
            }} className="w-full gap-1">
              <Landmark className="h-3 w-3" /> Update Bank Details
            </Button>
          </CardContent>
        </Card>

        {/* Pay History */}
        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <h3 className="font-semibold flex items-center gap-2 mb-4"><FileText className="h-4 w-4 text-primary" /> Pay History</h3>
            {paychecks.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="mx-auto mb-3 h-10 w-10 opacity-20" />
                <p className="text-muted-foreground">No paychecks yet</p>
                <p className="text-xs text-muted-foreground mt-1">Paychecks will appear here after your employer runs payroll</p>
              </div>
            ) : (
              <div className="space-y-2">
                {paychecks.map(pc => {
                  const pcc = pc.pay_country || 'US'
                  const pci = getCountry(pcc)
                  return (
                    <div key={pc.id} className="flex items-center justify-between rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setSelectedPaycheck(pc)}>
                      <div className="flex items-center gap-3">
                        <div className={`rounded-lg p-2 ${pc.status === 'paid' ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                          {pc.status === 'paid' ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : <Clock className="h-4 w-4 text-amber-600" />}
                        </div>
                        <div>
                          <p className="font-medium text-sm flex items-center gap-1.5">
                            {pci.flag} {new Date(pc.pay_period_start).toLocaleDateString()} – {new Date(pc.pay_period_end).toLocaleDateString()}
                          </p>
                          <p className="text-xs text-muted-foreground">Pay date: {new Date(pc.pay_date).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-emerald-600">{fmtCurrency(pc.net_pay, pcc)}</p>
                        <Badge variant={pc.status === 'paid' ? 'success' : 'secondary'} className="text-xs">{pc.status}</Badge>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Paycheck Detail Dialog */}
      {selectedPaycheck && (() => {
        const pcc = selectedPaycheck.pay_country || 'US'
        const pci = getCountry(pcc)
        const rd = parseRegionDeductions(selectedPaycheck.region_deductions)

        return (
          <Dialog open={true} onClose={() => setSelectedPaycheck(null)} className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-primary" /> Pay Stub
                <span className="text-sm">{pci.flag}</span>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Pay Period</p>
                  <p className="font-medium text-sm">{new Date(selectedPaycheck.pay_period_start).toLocaleDateString()} – {new Date(selectedPaycheck.pay_period_end).toLocaleDateString()}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Pay Date</p>
                  <p className="font-medium text-sm">{new Date(selectedPaycheck.pay_date).toLocaleDateString()}</p>
                </div>
              </div>

              {/* Earnings */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Earnings</h4>
                <div className="rounded-lg border divide-y">
                  <div className="flex justify-between p-3">
                    <span className="text-sm">Gross Pay</span>
                    <span className="font-semibold">{fmtCurrency(selectedPaycheck.gross_pay, pcc)}</span>
                  </div>
                  {selectedPaycheck.hours_worked && (
                    <div className="flex justify-between p-3 text-sm text-muted-foreground">
                      <span>Hours Worked</span>
                      <span>{selectedPaycheck.hours_worked}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Deductions — region-aware */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Deductions</h4>
                <div className="rounded-lg border divide-y">
                  {pcc === 'US' ? (
                    <>
                      <div className="flex justify-between p-3 text-sm">
                        <span>Federal Income Tax</span>
                        <span className="text-red-600">-{fmtCurrency(selectedPaycheck.federal_tax, 'US')}</span>
                      </div>
                      <div className="flex justify-between p-3 text-sm">
                        <span>State Income Tax</span>
                        <span className="text-red-600">-{fmtCurrency(selectedPaycheck.state_tax, 'US')}</span>
                      </div>
                      <div className="flex justify-between p-3 text-sm">
                        <span>Social Security (FICA)</span>
                        <span className="text-red-600">-{fmtCurrency(selectedPaycheck.social_security, 'US')}</span>
                      </div>
                      <div className="flex justify-between p-3 text-sm">
                        <span>Medicare</span>
                        <span className="text-red-600">-{fmtCurrency(selectedPaycheck.medicare, 'US')}</span>
                      </div>
                      {Number(selectedPaycheck.other_deductions) > 0 && (
                        <div className="flex justify-between p-3 text-sm">
                          <span>Other Deductions</span>
                          <span className="text-red-600">-{fmtCurrency(selectedPaycheck.other_deductions, 'US')}</span>
                        </div>
                      )}
                    </>
                  ) : pcc === 'IN' ? (
                    <>
                      {Object.entries(rd).map(([key, val]) => (
                        <div key={key} className="flex justify-between p-3 text-sm">
                          <span>{INDIA_LABELS[key] || key.replace(/([A-Z])/g, ' $1').trim()}</span>
                          <span className="text-red-600">-{fmtCurrency(val, 'IN')}</span>
                        </div>
                      ))}
                      {Object.keys(rd).length === 0 && Number(selectedPaycheck.other_deductions) > 0 && (
                        <div className="flex justify-between p-3 text-sm">
                          <span>Total Deductions</span>
                          <span className="text-red-600">-{fmtCurrency(selectedPaycheck.other_deductions, 'IN')}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    Object.entries(rd).map(([key, val]) => (
                      <div key={key} className="flex justify-between p-3 text-sm">
                        <span>{key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim()}</span>
                        <span className="text-red-600">-{fmtCurrency(val, pcc)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Net Pay */}
              <div className="rounded-lg bg-emerald-50 p-4 text-center">
                <p className="text-xs text-emerald-600 uppercase tracking-wide font-medium">Net Pay</p>
                <p className="text-3xl font-extrabold text-emerald-600 mt-1">{fmtCurrency(selectedPaycheck.net_pay, pcc)}</p>
              </div>

              <div className="flex gap-2">
                <a
                  href={`/api/payroll/runs/${selectedPaycheck.payroll_run_id}/payslip/${selectedPaycheck.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1"
                >
                  <Button variant="outline" className="w-full gap-2">
                    <ExternalLink className="h-4 w-4" /> View Printable Payslip
                  </Button>
                </a>
                <Button variant="outline" onClick={() => setSelectedPaycheck(null)}>Close</Button>
              </div>
            </div>
          </Dialog>
        )
      })()}

      {/* Bank Details Dialog */}
      <Dialog open={showBankEdit} onClose={() => setShowBankEdit(false)} className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Landmark className="h-5 w-5 text-primary" /> Update Bank Details</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Bank Name</Label>
            <Input value={bankName} onChange={e => setBankName(e.target.value)}
              placeholder={cc === 'IN' ? 'State Bank of India' : 'Chase Bank'} className="mt-1" />
          </div>
          <div>
            <Label>Account Last 4 Digits</Label>
            <Input maxLength={4} value={bankLast4} onChange={e => setBankLast4(e.target.value)} placeholder="1234" className="mt-1" />
          </div>
          <div>
            <Label>{cc === 'IN' ? 'IFSC Code' : 'Routing Number'}</Label>
            <Input value={bankRouting} onChange={e => setBankRouting(e.target.value)}
              placeholder={cc === 'IN' ? 'SBIN0001234' : '021000021'} className="mt-1" />
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={saveBankDetails} disabled={savingBank || !bankName || !bankLast4} className="gap-2">
              {savingBank ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <CheckCircle className="h-4 w-4" />}
              Save
            </Button>
            <Button variant="outline" onClick={() => setShowBankEdit(false)}>Cancel</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
