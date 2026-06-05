import { useState } from "react"
import { cn } from "@/lib/utils"

export type OmniScoreRingProps = {
  score: number
  size?: number
  strokeWidth?: number
  showLabel?: boolean
  className?: string
}

export function OmniScoreRing({
  score,
  size = 120,
  strokeWidth = 8,
  showLabel = true,
  className,
}: OmniScoreRingProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const progress = Math.min(Math.max(score, 0), 1000) / 1000
  const dashoffset = circumference - progress * circumference

  const getColor = (s: number) => {
    if (s >= 900) return "#f59e0b" // amber-500
    if (s >= 800) return "#8b5cf6" // violet-500
    if (s >= 700) return "#10b981" // emerald-500
    if (s >= 600) return "#3b82f6" // blue-500
    return "#64748b" // slate-500
  }

  const getLabel = (s: number) => {
    if (s >= 900) return "Elite"
    if (s >= 800) return "Excellent"
    if (s >= 700) return "Good"
    if (s >= 600) return "Average"
    return "Below Average"
  }

  const color = getColor(score)
  const label = getLabel(score)

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {/* Background circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-muted/20"
          />
          {/* Progress circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashoffset}
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold" style={{ color }}>
            {score}
          </span>
          {showLabel && (
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
          )}
        </div>
      </div>
    </div>
  )
}
