import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { apiCall } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  CheckCircle, Sparkles, Mic, Target, Share2, Lightbulb, ArrowRight, Loader2,
} from 'lucide-react'

export function PaymentSuccessPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [verifying, setVerifying] = useState(true)
  const sessionId = searchParams.get('session_id') || searchParams.get('checkout_session_id')

  useEffect(() => {
    async function verifyPayment() {
      if (!sessionId) {
        setVerifying(false)
        return
      }
      try {
        await apiCall(`/auth/verify-payment?session_id=${sessionId}`)
      } catch (err) {
        console.error('Payment verification error:', err)
      } finally {
        setVerifying(false)
      }
    }
    verifyPayment()
  }, [sessionId])

  const features = [
    { icon: Target, label: 'Full OmniScore (all factors)' },
    { icon: Mic, label: 'Unlimited mock interviews' },
    { icon: Sparkles, label: 'Role-specific score variants' },
    { icon: Share2, label: 'Shareable score badge' },
    { icon: Lightbulb, label: 'Detailed improvement tips' },
  ]

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="max-w-md w-full text-center border-primary/50 shadow-lg">
        <CardContent className="p-8 space-y-6">
          {verifying ? (
            <div className="py-12">
              <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
              <p className="text-sm text-muted-foreground mt-4">Verifying payment...</p>
            </div>
          ) : (
            <>
              <div className="text-6xl">🎉</div>
              <div className="space-y-2">
                <h1 className="text-3xl font-bold">Welcome to Pro!</h1>
                <p className="text-muted-foreground">
                  Your payment was successful. You now have unlimited access to all Rekrut AI features.
                </p>
              </div>

              <div className="bg-accent rounded-lg p-5 text-left">
                <h3 className="font-semibold text-sm mb-3 text-muted-foreground">What&apos;s unlocked:</h3>
                <ul className="space-y-2">
                  {features.map((feature) => (
                    <li key={feature.label} className="flex items-center gap-2 text-sm text-primary">
                      <CheckCircle className="h-4 w-4 shrink-0" />
                      {feature.label}
                    </li>
                  ))}
                </ul>
              </div>

              <Button size="lg" className="w-full" onClick={() => navigate('/dashboard')}>
                Go to Dashboard
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
