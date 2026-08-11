import {
  AlertCircle,
  ArrowRight,
  Briefcase,
  CheckCircle,
  FileText,
  GraduationCap,
  Linkedin,
  Loader2,
  Mail,
  MapPin,
  User,
  Wrench,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { apiCall } from '@/lib/api'

interface LinkedInImportData {
  name?: string
  email?: string
  photo?: string
  linkedin_url?: string
}

interface LinkedInImportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigateToSection: (section: string) => void
}

type ImportState = 'idle' | 'loading' | 'success' | 'error'

interface MissingField {
  label: string
  icon: React.ComponentType<{ className?: string }>
  section: string
}

const missingFields: MissingField[] = [
  { label: 'Headline', icon: FileText, section: 'personal' },
  { label: 'Bio / Summary', icon: FileText, section: 'personal' },
  { label: 'Location', icon: MapPin, section: 'personal' },
  { label: 'Experience', icon: Briefcase, section: 'experience' },
  { label: 'Education', icon: GraduationCap, section: 'education' },
  { label: 'Skills', icon: Wrench, section: 'skills' },
]

export function LinkedInImportModal({ open, onOpenChange, onNavigateToSection }: LinkedInImportModalProps) {
  const [state, setState] = useState<ImportState>('idle')
  const [data, setData] = useState<LinkedInImportData | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!open) {
      // Reset state when modal closes
      setState('idle')
      setData(null)
      setErrorMessage('')
      setErrorCode(undefined)
      return
    }

    async function fetchImport() {
      setState('loading')
      try {
        const result = await apiCall<LinkedInImportData & { error?: string; code?: string }>(
          '/candidate/linkedin/import',
          { method: 'POST' },
        )
        if (result.error) {
          setState('error')
          setErrorMessage(result.error)
          setErrorCode(result.code)
        } else {
          setData(result)
          setState('success')
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to import LinkedIn data'
        setState('error')
        setErrorMessage(message)
      }
    }

    fetchImport()
  }, [open])

  function handleNavigate(section: string) {
    onNavigateToSection(section)
    onOpenChange(false)
  }

  function handleReauth() {
    // Trigger LinkedIn OAuth re-authentication
    window.location.href = '/api/auth/linkedin/url'
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <div className="w-full max-w-md mx-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Linkedin className="h-4 w-4 text-white" />
            </div>
            <DialogTitle className="text-lg font-semibold">LinkedIn Import</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground">
            We&apos;ve connected your LinkedIn profile. Here&apos;s what we were able to import.
          </DialogDescription>
        </DialogHeader>

        {state === 'loading' && (
          <div className="flex flex-col items-center justify-center py-10 space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Importing your LinkedIn profile...</p>
          </div>
        )}

        {state === 'error' && (
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 p-4">
              <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-red-900 dark:text-red-100">Import Failed</p>
                <p className="text-sm text-red-700 dark:text-red-200">{errorMessage}</p>
              </div>
            </div>
            {errorCode === 'TOKEN_EXPIRED' && (
              <Button onClick={handleReauth} className="w-full gap-2">
                <Linkedin className="h-4 w-4" />
                Re-authenticate with LinkedIn
              </Button>
            )}
          </div>
        )}

        {state === 'success' && data && (
          <div className="space-y-4">
            {/* Imported fields */}
            <Card className="border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20">
              <CardContent className="p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-green-700 dark:text-green-300">
                  Successfully Imported
                </p>

                {data.photo && (
                  <div className="flex items-center gap-3">
                    <Avatar src={data.photo} alt={data.name || 'Profile'} size="md" />
                    <div>
                      <p className="text-sm font-medium">Profile Photo</p>
                      <p className="text-xs text-muted-foreground">From LinkedIn</p>
                    </div>
                    <CheckCircle className="h-4 w-4 text-green-500 ml-auto shrink-0" />
                  </div>
                )}

                {data.name && (
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                      <User className="h-4 w-4 text-green-600 dark:text-green-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{data.name}</p>
                      <p className="text-xs text-muted-foreground">Name</p>
                    </div>
                    <CheckCircle className="h-4 w-4 text-green-500 ml-auto shrink-0" />
                  </div>
                )}

                {data.email && (
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                      <Mail className="h-4 w-4 text-green-600 dark:text-green-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{data.email}</p>
                      <p className="text-xs text-muted-foreground">Email</p>
                    </div>
                    <CheckCircle className="h-4 w-4 text-green-500 ml-auto shrink-0" />
                  </div>
                )}

                {!data.name && !data.email && !data.photo && (
                  <p className="text-sm text-muted-foreground">
                    No basic profile data was returned. You may need to re-authenticate.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Missing fields */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
                Fields to Complete
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {missingFields.map((field) => {
                  const Icon = field.icon
                  return (
                    <button
                      key={field.label}
                      onClick={() => handleNavigate(field.section)}
                      className="flex items-center gap-3 rounded-xl border bg-card p-3 hover:bg-muted/50 transition-colors text-left group"
                    >
                      <div className="h-8 w-8 rounded-lg bg-indigo-100 dark:bg-indigo-950/30 flex items-center justify-center shrink-0">
                        <Icon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{field.label}</p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Info message */}
            <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3">
              <p className="text-xs text-amber-800 dark:text-amber-200">
                LinkedIn limits what third-party apps can access. Please add your experience and
                skills manually.
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2 mt-5">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto gap-1">
            <X className="h-4 w-4" />
            Skip for now
          </Button>
          {state === 'success' && (
            <Button onClick={() => onOpenChange(false)} className="w-full sm:w-auto gap-1">
              Complete Profile
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </DialogFooter>
      </div>
    </Dialog>
  )
}
