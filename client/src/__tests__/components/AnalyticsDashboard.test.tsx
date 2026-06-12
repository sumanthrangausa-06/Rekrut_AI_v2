import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AnalyticsDashboard } from '@/components/recruiter/AnalyticsDashboard'

// Mock the API module
vi.mock('@/lib/api', () => ({
  apiCall: vi.fn()
}))

import { apiCall } from '@/lib/api'

const mockApiCall = vi.mocked(apiCall)

describe('AnalyticsDashboard', () => {
  beforeEach(() => {
    mockApiCall.mockClear()
  })

  it('renders analytics dashboard', () => {
    render(<AnalyticsDashboard />)
    expect(screen.getByText(/analytics dashboard/i)).toBeInTheDocument()
  })

  it('displays KPI metrics', async () => {
    mockApiCall.mockResolvedValueOnce({
      total_candidates: 100,
      total_applications: 50,
      conversion_rate: 50,
      avg_time_to_hire: 30
    })

    render(<AnalyticsDashboard />)

    await waitFor(() => {
      expect(screen.getByText(/100/)).toBeInTheDocument()
      expect(screen.getByText(/50/)).toBeInTheDocument()
    })
  })

  it('handles loading state', () => {
    render(<AnalyticsDashboard />)
    expect(screen.getByText(/loading analytics/i)).toBeInTheDocument()
  })

  it('handles API errors', async () => {
    mockApiCall.mockRejectedValueOnce(new Error('Failed to load analytics'))

    render(<AnalyticsDashboard />)

    await waitFor(() => {
      expect(screen.getByText(/error loading analytics/i)).toBeInTheDocument()
    })
  })

  it('displays charts when data loaded', async () => {
    mockApiCall.mockResolvedValueOnce({
      total_candidates: 100,
      total_applications: 50,
      conversion_rate: 50,
      avg_time_to_hire: 30
    })

    render(<AnalyticsDashboard />)

    await waitFor(() => {
      expect(screen.getByTestId('analytics-chart')).toBeInTheDocument()
    })
  })
})
