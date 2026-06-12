import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { ProfilePage } from '@/pages/candidate/profile'

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

describe('ProfilePage', () => {
  beforeEach(() => {
    mockApiCall.mockClear()
  })

  it('renders profile sections', () => {
    renderWithRouter(<ProfilePage />)
    expect(screen.getByText(/overview/i)).toBeInTheDocument()
    expect(screen.getByText(/experience/i)).toBeInTheDocument()
    expect(screen.getByText(/education/i)).toBeInTheDocument()
    expect(screen.getByText(/skills/i)).toBeInTheDocument()
  })

  it('shows loading state initially', () => {
    renderWithRouter(<ProfilePage />)
    expect(screen.getByText(/loading profile/i)).toBeInTheDocument()
  })

  it('displays user data after loading', async () => {
    mockApiCall.mockResolvedValueOnce({
      id: 1,
      name: 'Test User',
      email: 'test@example.com',
      headline: 'Software Engineer',
      summary: 'Experienced developer',
      experience: [],
      education: [],
      skills: []
    })

    renderWithRouter(<ProfilePage />)

    await waitFor(() => {
      expect(screen.getByText('Test User')).toBeInTheDocument()
    })
  })

  it('handles API errors gracefully', async () => {
    mockApiCall.mockRejectedValueOnce(new Error('Failed to load profile'))

    renderWithRouter(<ProfilePage />)

    await waitFor(() => {
      expect(screen.getByText(/error loading profile/i)).toBeInTheDocument()
    })
  })

  it('allows adding new experience', async () => {
    mockApiCall.mockResolvedValueOnce({
      id: 1,
      name: 'Test User',
      email: 'test@example.com',
      experience: []
    })

    renderWithRouter(<ProfilePage />)

    await waitFor(() => {
      expect(screen.getByText('Test User')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText(/add experience/i))

    await waitFor(() => {
      expect(screen.getByLabelText(/company/i)).toBeInTheDocument()
    })
  })
})
