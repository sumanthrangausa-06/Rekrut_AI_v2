import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/auth-context'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Menu, Bell, LogOut, User, ChevronDown } from 'lucide-react'

interface HeaderProps {
  onMenuToggle: () => void
  sidebarOpen: boolean
}

export function Header({ onMenuToggle, sidebarOpen }: HeaderProps) {
  const { user, logout, isRecruiter } = useAuth()
  const navigate = useNavigate()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-card/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/60 lg:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuToggle}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-2 hover:bg-muted lg:hidden"
          aria-label={sidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-controls="primary-navigation"
          aria-expanded={sidebarOpen}
        >
          <Menu className="h-5 w-5" />
        </button>
        <Badge variant={isRecruiter ? 'default' : 'secondary'} className="hidden sm:inline-flex">
          {isRecruiter ? 'Recruiter' : 'Candidate'}
        </Badge>
      </div>

      <div className="flex items-center gap-2">
        <button
          className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label="Notifications"
          title="Notifications"
        >
          <Bell className="h-5 w-5 text-muted-foreground" />
        </button>

        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex min-h-[44px] items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-haspopup="menu"
            aria-expanded={dropdownOpen}
            aria-controls="user-menu"
          >
            <Avatar src={user?.avatar_url} fallback={user?.name || 'U'} size="sm" />
            <span className="hidden text-sm font-medium md:block">{user?.name || 'User'}</span>
            <ChevronDown className="hidden h-4 w-4 text-muted-foreground md:block" />
          </button>

          {dropdownOpen && (
            <div
              id="user-menu"
              role="menu"
              aria-label="User menu"
              className="absolute right-0 mt-2 w-56 rounded-lg border bg-card shadow-lg"
            >
              <div className="border-b px-4 py-3">
                <p className="text-sm font-medium">{user?.name}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
              <div className="p-1">
                <button
                  role="menuitem"
                  onClick={() => {
                    setDropdownOpen(false)
                    navigate(isRecruiter ? '/recruiter/company' : '/candidate/profile')
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
                >
                  <User className="h-4 w-4" />
                  Profile
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setDropdownOpen(false)
                    logout()
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
