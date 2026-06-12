import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { VoiceFeatures } from '@/components/voice-features'

// Mock the API module
vi.mock('@/lib/api', () => ({
  apiCall: vi.fn()
}))

import { apiCall } from '@/lib/api'

const mockApiCall = vi.mocked(apiCall)

describe('VoiceFeatures', () => {
  beforeEach(() => {
    mockApiCall.mockClear()
  })

  it('renders TTS and STT sections', () => {
    render(<VoiceFeatures />)
    expect(screen.getByText(/text to speech/i)).toBeInTheDocument()
    expect(screen.getByText(/speech to text/i)).toBeInTheDocument()
  })

  it('generates speech from text', async () => {
    mockApiCall.mockResolvedValueOnce({
      success: true,
      audio_url: 'https://example.com/audio.mp3'
    })

    render(<VoiceFeatures />)
    
    fireEvent.change(screen.getByPlaceholderText(/enter text to convert/i), {
      target: { value: 'Hello world' }
    })
    
    fireEvent.click(screen.getByRole('button', { name: /generate speech/i }))

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith('/voice/tts', expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          text: 'Hello world',
          voice_id: 'f9fc912e-52f0-448a-8bfa-47e9ca75f25a'
        })
      }))
    })
  })

  it('shows audio player after generation', async () => {
    mockApiCall.mockResolvedValueOnce({
      success: true,
      audio_url: 'https://example.com/audio.mp3'
    })

    render(<VoiceFeatures />)
    
    fireEvent.change(screen.getByPlaceholderText(/enter text to convert/i), {
      target: { value: 'Hello world' }
    })
    
    fireEvent.click(screen.getByRole('button', { name: /generate speech/i }))

    await waitFor(() => {
      expect(screen.getByRole('audio')).toBeInTheDocument()
    })
  })

  it('handles TTS errors', async () => {
    mockApiCall.mockRejectedValueOnce(new Error('TTS failed'))

    render(<VoiceFeatures />)
    
    fireEvent.change(screen.getByPlaceholderText(/enter text to convert/i), {
      target: { value: 'Hello world' }
    })
    
    fireEvent.click(screen.getByRole('button', { name: /generate speech/i }))

    await waitFor(() => {
      expect(screen.getByText(/error generating speech/i)).toBeInTheDocument()
    })
  })

  it('starts recording for STT', async () => {
    render(<VoiceFeatures />)
    
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }))

    await waitFor(() => {
      expect(screen.getByText(/recording/i)).toBeInTheDocument()
    })
  })
})