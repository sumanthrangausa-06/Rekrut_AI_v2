import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { ApplicationForm } from '@/components/jobs/ApplicationForm'

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

describe('ApplicationForm', () => {
  beforeEach(() => {
    mockApiCall.mockClear()
  })

  it('renders application form fields', () => {
    renderWithRouter(<ApplicationForm jobId={1} />)
    expect(screen.getByLabelText(/cover letter/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/resume/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /submit application/i })).toBeInTheDocument()
  })

  it('submits application with valid data', async () => {
    mockApiCall.mockResolvedValueOnce({
      id: 1,
      status: 'pending'
    })

    renderWithRouter(<ApplicationForm jobId={1} />)
    
    fireEvent.change(screen.getByLabelText(/cover letter/i), {
      target: { value: 'I am very interested in this position.' }
    })
    
    fireEvent.click(screen.getByRole('button', { name: /submit application/i }))

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith('/applications', expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          job_id: 1,
          cover_letter: 'I am very interested in this position.'
        })
      }))
    })
  })

  it('validates required cover letter', async () => {
    renderWithRouter(<ApplicationForm jobId={1} />)
    
    fireEvent.click(screen.getByRole('button', { name: /submit application/i }))

    await waitFor(() => {
      expect(screen.getByText(/cover letter is required/i)).toBeInTheDocument()
    })
  })

  it('handles file upload', async () => {
    mockApiCall.mockResolvedValueOnce({
      id: 1,
      status: 'pending'
    })

    renderWithRouter(<ApplicationForm jobId={1} />)
    
    const file = new File(['resume content'], 'resume.pdf', { type: 'application/pdf' })
    
    fireEvent.change(screen.getByLabelText(/resume/i), {
      target: { files: [file] }
    })
    
    fireEvent.change(screen.getByLabelText(/cover letter/i), {
      target: { value: 'I am very interested in this position.' }
    })
    
    fireEvent.click(screen.getByRole('button', { name: /submit application/i }))

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalled()
    })
  })

  it('shows success message after submission', async () => {
    mockApiCall.mockResolvedValueOnce({
      id: 1,
      status: 'pending'
    })

    renderWithRouter(<ApplicationForm jobId={1} />)
    
    fireEvent.change(screen.getByLabelText(/cover letter/i), {
      target: { value: 'I am very interested in this position.' }
    })
    
    fireEvent.click(screen.getByRole('button', { name: /submit application/i }))

    await waitFor(() => {
      expect(screen.getByText(/application submitted successfully/i)).toBeInTheDocument()
    })
  })

  it('handles API errors', async () => {
    mockApiCall.mockRejectedValueOnce(new Error('Failed to submit application'))

    renderWithRouter(<ApplicationForm jobId={1} />)
    
    fireEvent.change(screen.getByLabelText(/cover letter/i), {
      target: { value: 'I am very interested in this position.' }
    })
    
    fireEvent.click(screen.getByRole('button', { name: /submit application/i }))

    await waitFor(() => {
      expect(screen.getByText(/error submitting application/i)).toBeInTheDocument()
    })
  })
})
