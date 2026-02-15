// Shared utilities and components for AI Coaching features
// Extracted from ai-coaching.tsx to reduce monolith

import { Brain, Zap, Lightbulb } from 'lucide-react'

// Category configuration
export const categoryConfig: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  behavioral: { label: 'Behavioral', icon: Brain, color: 'text-violet-700', bg: 'bg-violet-100' },
  technical: { label: 'Technical', icon: Zap, color: 'text-rose-700', bg: 'bg-rose-100' },
  situational: { label: 'Situational', icon: Lightbulb, color: 'text-sky-700', bg: 'bg-sky-100' },
}

export const difficultyColors: Record<string, string> = {
  Easy: 'bg-green-100 text-green-700',
  Medium: 'bg-amber-100 text-amber-700',
  Hard: 'bg-red-100 text-red-700',
}

// Score color helper
export function scoreColor(score: number): string {
  if (score >= 8) return 'text-green-600'
  if (score >= 6) return 'text-amber-600'
  return 'text-red-600'
}

export function scoreBg(score: number): string {
  if (score >= 8) return 'bg-green-50 border-green-200'
  if (score >= 6) return 'bg-amber-50 border-amber-200'
  return 'bg-red-50 border-red-200'
}

export function scoreLabel(score: number): string {
  if (score >= 9) return 'Excellent'
  if (score >= 8) return 'Great'
  if (score >= 7) return 'Good'
  if (score >= 6) return 'Decent'
  if (score >= 5) return 'Average'
  return 'Needs Work'
}

// Score bar component — handles null score (analysis failed)
export function ScoreBar({ score, label, icon: Icon }: { score: number | null; label: string; icon: React.ElementType }) {
  const failed = score === null || score === undefined
  const displayScore = failed ? 0 : score
  const pct = (displayScore / 10) * 100
  const barColor = failed ? 'bg-muted-foreground/30' : displayScore >= 8 ? 'bg-green-500' : displayScore >= 6 ? 'bg-amber-500' : 'bg-red-500'

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 font-medium">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          {label}
        </span>
        {failed ? (
          <span className="font-bold text-muted-foreground text-xs">Failed</span>
        ) : (
          <span className={`font-bold ${scoreColor(displayScore)}`}>{displayScore}/10</span>
        )}
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${barColor} rounded-full transition-all duration-700`} style={{ width: failed ? '0%' : `${pct}%` }} />
      </div>
    </div>
  )
}

// Time formatting helper
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
