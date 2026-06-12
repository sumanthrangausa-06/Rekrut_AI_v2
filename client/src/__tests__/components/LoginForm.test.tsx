import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { LoginForm } from '@/components/auth/LoginForm'

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

describe('LoginForm', () => {
  beforeEach(() => {
    mockApiCall.mockClear()
  })

  it('renders email and password fields', () => {
    renderWithRouter(<LoginForm />)
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('validates email format', async () => {
    renderWithRouter(<LoginForm />)
    const emailInput = screen.getByLabelText(/email/i)
    
    fireEvent.change(emailInput, { target: { value: 'invalid-email' } })
    fireEvent.blur(emailInput)
    
    await waitFor(() => {
      expect(screen.getByText(/invalid email format/i)).toBeInTheDocument()
    })
  })

  it('submits with valid credentials', async () => {
    mockApiCall.mockResolvedValueOnce({
      token: 'test-token',
      user: { id: 1, email: 'test@example.com', role: 'candidate' }
    })

    renderWithRouter(<LoginForm />)
    
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'test@example.com' }
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password123' }
    })
    
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    
    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith('/auth/login', expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          email: 'test@example.com',
          password: 'password123'
        })
      }))
    })
  })

  it('shows error on invalid credentials', async () => {
    mockApiCall.mockRejectedValueOnce(new Error('Invalid credentials'))

    renderWithRouter(<LoginForm />)
    
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'test@example.com' }
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'wrongpassword' }
    })
    
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    
    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument()
    })
  })

  it('disables submit button while loading', async () => {
    mockApiCall.mockImplementation(() => new Promise(() => {}))

    renderWithRouter(<LoginForm />)
    
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'test@example.com' }
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password123' }
    })
    
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled()
    })
  })
})
