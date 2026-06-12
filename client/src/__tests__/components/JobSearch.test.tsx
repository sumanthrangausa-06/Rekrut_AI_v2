import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { JobSearch } from '@/components/jobs/JobSearch'

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

describe('JobSearch', () => {
  beforeEach(() => {
    mockApiCall.mockClear()
  })

  it('renders search input and filters', () => {
    renderWithRouter(<JobSearch />)
    expect(screen.getByPlaceholderText(/search jobs/i)).toBeInTheDocument()
    expect(screen.getByText(/location/i)).toBeInTheDocument()
    expect(screen.getByText(/job type/i)).toBeInTheDocument()
  })

  it('submits search query', async () => {
    mockApiCall.mockResolvedValueOnce({
      jobs: [],
      total: 0,
      page: 1
    })

    renderWithRouter(<JobSearch />)
    
    fireEvent.change(screen.getByPlaceholderText(/search jobs/i), {
      target: { value: 'software engineer' }
    })
    
    fireEvent.click(screen.getByRole('button', { name: /search/i }))

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith('/jobs', expect.objectContaining({
        method: 'GET',
        params: expect.objectContaining({
          q: 'software engineer'
        })
      }))
    })
  })

  it('applies location filter', async () => {
    mockApiCall.mockResolvedValueOnce({
      jobs: [],
      total: 0,
      page: 1
    })

    renderWithRouter(<JobSearch />)
    
    fireEvent.change(screen.getByLabelText(/location/i), {
      target: { value: 'San Francisco' }
    })
    
    fireEvent.click(screen.getByRole('button', { name: /search/i }))

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith('/jobs', expect.objectContaining({
        method: 'GET',
        params: expect.objectContaining({
          location: 'San Francisco'
        })
      }))
    })
  })

  it('applies job type filter', async () => {
    mockApiCall.mockResolvedValueOnce({
      jobs: [],
      total: 0,
      page: 1
    })

    renderWithRouter(<JobSearch />)
    
    fireEvent.change(screen.getByLabelText(/job type/i), {
      target: { value: 'full-time' }
    })
    
    fireEvent.click(screen.getByRole('button', { name: /search/i }))

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith('/jobs', expect.objectContaining({
        method: 'GET',
        params: expect.objectContaining({
          job_type: 'full-time'
        })
      }))
    })
  })

  it('displays job results', async () => {
    mockApiCall.mockResolvedValueOnce({
      jobs: [
        {
          id: 1,
          title: 'Software Engineer',
          company: 'Test Company',
          location: 'Remote',
          salary_min: 100000,
          salary_max: 150000,
          job_type: 'full-time'
        }
      ],
      total: 1,
      page: 1
    })

    renderWithRouter(<JobSearch />)
    
    fireEvent.click(screen.getByRole('button', { name: /search/i }))

    await waitFor(() => {
      expect(screen.getByText('Software Engineer')).toBeInTheDocument()
      expect(screen.getByText('Test Company')).toBeInTheDocument()
    })
  })

  it('handles empty results', async () => {
    mockApiCall.mockResolvedValueOnce({
      jobs: [],
      total: 0,
      page: 1
    })

    renderWithRouter(<JobSearch />)
    
    fireEvent.click(screen.getByRole('button', { name: /search/i }))

    await waitFor(() => {
      expect(screen.getByText(/no jobs found/i)).toBeInTheDocument()
    })
  })

  it('handles API errors', async () => {
    mockApiCall.mockRejectedValueOnce(new Error('Failed to search jobs'))

    renderWithRouter(<JobSearch />)
    
    fireEvent.click(screen.getByRole('button', { name: /search/i }))

    await waitFor(() => {
      expect(screen.getByText(/error searching jobs/i)).toBeInTheDocument()
    })
  })
})
