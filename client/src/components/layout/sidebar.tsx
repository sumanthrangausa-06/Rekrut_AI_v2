import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/auth-context'
import {
  LayoutDashboard,
  Briefcase,
  Users,
  FileText,
  MessageSquare,
  BarChart3,
  Settings,
  CreditCard,
  ClipboardCheck,
  UserCheck,
  GraduationCap,
  Star,
  Building2,
  X,
  Wallet,
  Sparkles,
} from 'lucide-react'

interface SidebarProps {
  open: boolean
  onClose: () => void
}

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
}

const candidateNav: NavItem[] = [
  { label: 'Dashboard', href: '/candidate', icon: LayoutDashboard },
  { label: 'Job Board', href: '/candidate/jobs', icon: Briefcase },
  { label: 'Applications', href: '/candidate/applications', icon: FileText },
  { label: 'Profile', href: '/candidate/profile', icon: UserCheck },
  { label: 'Assessments', href: '/candidate/assessments', icon: GraduationCap },
  { label: 'Interviews', href: '/candidate/interviews', icon: MessageSquare },
  { label: 'AI Coaching', href: '/candidate/ai-coaching', icon: Sparkles },
  { label: 'Offers', href: '/candidate/offers', icon: CreditCard },
  { label: 'Onboarding', href: '/candidate/onboarding', icon: ClipboardCheck },
  { label: 'Pay & Compensation', href: '/candidate/payroll', icon: CreditCard },
  { label: 'OmniScore', href: '/candidate/omniscore', icon: Star },
]

const recruiterNav: NavItem[] = [
  { label: 'Dashboard', href: '/recruiter', icon: LayoutDashboard },
  { label: 'Jobs', href: '/recruiter/jobs', icon: Briefcase },
  { label: 'Applications', href: '/recruiter/applications', icon: FileText },
  { label: 'Assessments', href: '/recruiter/assessments', icon: GraduationCap },
  { label: 'Candidates', href: '/recruiter/candidates', icon: Users },
  { label: 'Interviews', href: '/recruiter/interviews', icon: MessageSquare },
  { label: 'Offers', href: '/recruiter/offers', icon: CreditCard },
  { label: 'Onboarding', href: '/recruiter/onboarding', icon: UserCheck },
  { label: 'Analytics', href: '/recruiter/analytics', icon: BarChart3 },
  { label: 'Company', href: '/recruiter/company', icon: Building2 },
  { label: 'Payroll', href: '/recruiter/payroll', icon: Wallet },
]

export function Sidebar({ open, onClose }: SidebarProps) {
  const { isRecruiter } = useAuth()
  const location = useLocation()
  const navItems = isRecruiter ? recruiterNav : candidateNav

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-card transition-transform duration-200 lg:translate-x-0 lg:static lg:z-auto',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center justify-between border-b px-6">
          <NavLink to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-heading font-bold text-sm">
              H
            </div>
            <span className="font-heading text-lg font-bold">Rekrut AI</span>
          </NavLink>
          <button
            onClick={onClose}
            className="rounded-md p-1 hover:bg-muted lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              end={item.href === '/candidate' || item.href === '/recruiter'}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Bottom section */}
        <div className="border-t p-3">
          <NavLink
            to="/settings"
            onClick={onClose}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              location.pathname === '/settings'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Settings className="h-4 w-4 shrink-0" />
            Settings
          </NavLink>
        </div>
      </aside>
    </>
  )
}
