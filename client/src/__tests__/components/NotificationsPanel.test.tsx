import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { NotificationsPanel } from '@/components/notifications/NotificationsPanel'

// Mock the API module
vi.mock('@/lib/api', () => ({
  apiCall: vi.fn()
}))

import { apiCall } from '@/lib/api'

const mockApiCall = vi.mocked(apiCall)

function renderWithRouter(component: React.ReactNode) {
  return render(
    <BrowserRouter>
      {component}
    </BrowserRouter>
  )
}

describe('NotificationsPanel', () => {
  beforeEach(() => {
    mockApiCall.mockClear()
  })

  it('renders notifications panel', () => {
    renderWithRouter(<NotificationsPanel />)
    expect(screen.getByText(/notifications/i)).toBeInTheDocument()
  })

  it('displays list of notifications', async () => {
    mockApiCall.mockResolvedValueOnce([
      {
        id: 1,
        title: 'New Application',
        message: 'John Doe applied to Software Engineer position',
        read: false,
        created_at: '2024-01-15T10:00:00Z'
      },
      {
        id: 2,
        title: 'Interview Scheduled',
        message: 'Interview with Jane Smith tomorrow at 2pm',
        read: true,
        created_at: '2024-01-14T15:00:00Z'
      }
    ])

    renderWithRouter(<NotificationsPanel />)

    await waitFor(() => {
      expect(screen.getByText('New Application')).toBeInTheDocument()
      expect(screen.getByText('Interview Scheduled')).toBeInTheDocument()
    })
  })

  it('marks notification as read', async () => {
    mockApiCall.mockResolvedValueOnce([
      {
        id: 1,
        title: 'New Application',
        message: 'John Doe applied to Software Engineer position',
        read: false,
        created_at: '2024-01-15T10:00:00Z'
      }
    ])

    renderWithRouter(<NotificationsPanel />)

    await waitFor(() => {
      expect(screen.getByText('New Application')).toBeInTheDocument()
    })

    // Mock the mark as read API call
    mockApiCall.mockResolvedValueOnce({ success: true })

    // Click on the notification to mark as read
    const notification = screen.getByText('New Application')
    notification.click()

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith(
        '/notifications/1/read',
        expect.objectContaining({
          method: 'POST'
        })
      )
    })
  })

  it('handles empty notifications', async () => {
    mockApiCall.mockResolvedValueOnce([])

    renderWithRouter(<NotificationsPanel />)

    await waitFor(() => {
      expect(screen.getByText(/no notifications/i)).toBeInTheDocument()
    })
  })

  it('handles API errors', async () => {
    mockApiCall.mockRejectedValueOnce(new Error('Failed to load notifications'))

    renderWithRouter(<NotificationsPanel />)

    await waitFor(() => {
      expect(screen.getByText(/error loading notifications/i)).toBeInTheDocument()
    })
  })
})