import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export function InterviewPage() {
  const navigate = useNavigate()

  useEffect(() => {
    navigate('/candidate/ai-coaching', { replace: true })
  }, [navigate])

  return null
}
