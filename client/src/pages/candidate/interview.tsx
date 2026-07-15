import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export function InterviewPage() {
	const navigate = useNavigate()

	useEffect(() => {
		navigate('/candidate/ai-coaching', { replace: true })
	}, [navigate])

	return (
		<div className='px-4 md:px-6 lg:px-8 max-w-full flex items-center justify-center py-20 min-h-[50vh]'>
			<div className='text-center space-y-3'>
				<div className='animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto' />
				<p className='text-muted-foreground text-sm'>Redirecting to AI Interview Coach...</p>
			</div>
		</div>
	)
}
