import { useLocation } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Construction } from 'lucide-react'

export function PlaceholderPage() {
  const location = useLocation()
  const pageName = location.pathname
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/-/g, ' ')
    ?.replace(/\b\w/g, (c) => c.toUpperCase()) || 'Page'

  return (
    <div className="flex items-center justify-center py-20">
      <Card className="max-w-md text-center">
        <CardContent className="p-8">
          <Construction className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
          <h2 className="font-heading text-xl font-semibold">{pageName}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            This module is being rebuilt with the new architecture. Coming in Phase 2.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
