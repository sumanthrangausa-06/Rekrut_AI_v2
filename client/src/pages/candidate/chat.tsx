import { ChatPage } from '@/components/domain/chat'

export function CandidateChatPage() {
	return (
		<div className='px-4 md:px-6 lg:px-8 max-w-full'>
			<ChatPage mode='candidate' />
		</div>
	)
}
