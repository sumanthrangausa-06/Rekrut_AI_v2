import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Bot, X, Minus, Send, Trash2, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAIChat } from '@/hooks/use-ai-chat'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

// ─── Types ──────────────────────────────────────────────────
type ChatState = 'closed' | 'open' | 'minimized'

// ─── Helpers ────────────────────────────────────────────────
function formatTime(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString('en-US', {
		hour: '2-digit',
		minute: '2-digit',
	})
}

function getPageTitle(path: string): string {
	// Extract meaningful page title from path
	const segments = path.split('/').filter(Boolean)
	if (segments.length === 0) return 'Dashboard'
	const last = segments[segments.length - 1]
	return last
		.split('-')
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ')
}

// ─── Typing Indicator ───────────────────────────────────────
function TypingIndicator() {
	return (
		<div className='flex items-end gap-2'>
			<div className='h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0'>
				<Bot className='h-4 w-4 text-primary' />
			</div>
			<div className='bg-muted rounded-2xl rounded-tl-sm px-4 py-3'>
				<div className='flex items-center gap-1.5'>
					<div
						className='h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce'
						style={{ animationDelay: '0ms' }}
					/>
					<div
						className='h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce'
						style={{ animationDelay: '150ms' }}
					/>
					<div
						className='h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce'
						style={{ animationDelay: '300ms' }}
					/>
				</div>
			</div>
		</div>
	)
}

// ─── Main Component ─────────────────────────────────────────
export function AIChatFAB() {
	const [chatState, setChatState] = useState<ChatState>('closed')
	const [inputText, setInputText] = useState('')
	const messagesEndRef = useRef<HTMLDivElement>(null)
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const containerRef = useRef<HTMLDivElement>(null)
	const location = useLocation()

	const pageTitle = getPageTitle(location.pathname)
	const context = {
		page: pageTitle,
		path: location.pathname,
	}

	const { messages, loading, error, sendMessage, clearHistory, dismissError } = useAIChat(context)

	// Auto-scroll to bottom when messages change or loading starts
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [messages, loading])

	// Focus textarea when opening
	useEffect(() => {
		if (chatState === 'open') {
			const timer = setTimeout(() => textareaRef.current?.focus(), 300)
			return () => clearTimeout(timer)
		}
	}, [chatState])

	// Close on Escape key
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && chatState === 'open') {
				setChatState('closed')
			}
		}
		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	}, [chatState])

	// Prevent body scroll when chat is open on mobile
	useEffect(() => {
		if (chatState === 'open' && window.innerWidth < 768) {
			const previousOverflow = document.body.style.overflow
			document.body.style.overflow = 'hidden'
			return () => {
				document.body.style.overflow = previousOverflow
			}
		}
	}, [chatState])

	const handleSend = useCallback(async () => {
		if (!inputText.trim() || loading) return
		const text = inputText.trim()
		setInputText('')
		await sendMessage(text)
	}, [inputText, loading, sendMessage])

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault()
				handleSend()
			}
		},
		[handleSend],
	)

	const handleOpen = () => setChatState('open')
	const handleMinimize = () => setChatState('minimized')
	const handleClose = () => setChatState('closed')
	const handleRestore = () => setChatState('open')

	const isOpen = chatState === 'open'
	const isMinimized = chatState === 'minimized'
	const isClosed = chatState === 'closed'

	return (
		<div className='fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6'>
			{/* ─── Chat Panel ───────────────────────────────────── */}
			<div
				ref={containerRef}
				className={cn(
					'flex flex-col bg-card border shadow-2xl overflow-hidden transition-all duration-300 ease-out origin-bottom-right',
					// Mobile: full screen
					'isOpen'
						? 'fixed inset-0 rounded-none sm:static sm:inset-auto sm:w-[400px] sm:h-[600px] sm:rounded-2xl'
						: 'w-0 h-0 opacity-0 scale-95 pointer-events-none sm:w-0 sm:h-0',
					// Minimized: tiny peek or fully hidden
					isMinimized && 'hidden',
				)}
				style={{
					// Use inline styles for the transition to avoid Tailwind class conflicts
					display: isOpen ? 'flex' : 'none',
				}}
			>
				{/* Header */}
				<div className='flex items-center justify-between px-4 py-3 border-b bg-card shrink-0'>
					<div className='flex items-center gap-2.5'>
						<div className='h-8 w-8 rounded-full bg-black flex items-center justify-center'>
							<Bot className='h-4 w-4 text-white' />
						</div>
						<div>
							<h3 className='font-semibold text-sm leading-tight'>AI Assistant</h3>
							<p className='text-[11px] text-muted-foreground leading-tight'>
								{pageTitle}
							</p>
						</div>
					</div>
					<div className='flex items-center gap-1'>
						<Button
							variant='ghost'
							size='sm'
							className='h-8 w-8 p-0 text-muted-foreground hover:text-foreground'
							onClick={handleMinimize}
							title='Minimize'
						>
							<Minus className='h-4 w-4' />
						</Button>
						<Button
							variant='ghost'
							size='sm'
							className='h-8 w-8 p-0 text-muted-foreground hover:text-foreground'
							onClick={handleClose}
							title='Close'
						>
							<X className='h-4 w-4' />
						</Button>
					</div>
				</div>

				{/* Messages Area */}
				<ScrollArea className='flex-1 px-4 py-4'>
					<div className='space-y-4'>
						{messages.length === 0 && (
							<div className='flex flex-col items-center justify-center py-8 text-center'>
								<div className='h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3'>
									<Sparkles className='h-6 w-6 text-primary' />
								</div>
								<p className='text-sm font-medium text-foreground mb-1'>
									How can I help you?
								</p>
								<p className='text-xs text-muted-foreground max-w-[240px]'>
									Ask me anything about your job search, applications, interviews, or career advice.
								</p>
							</div>
						)}

						{messages.map((msg) => {
							const isUser = msg.role === 'user'
							const isError = msg.content.startsWith('❌')
							return (
								<div
									key={msg.id}
									className={cn(
										'flex gap-2',
										isUser ? 'flex-row-reverse' : 'flex-row',
									)}
								>
									{/* Avatar */}
									<div
										className={cn(
											'h-7 w-7 rounded-full flex items-center justify-center shrink-0 mt-0.5',
											isUser ? 'bg-primary/10' : 'bg-black',
										)}
									>
										{isUser ? (
											<span className='text-[10px] font-bold text-primary'>You</span>
										) : (
											<Bot className='h-3.5 w-3.5 text-white' />
										)}
									</div>

									{/* Message Bubble */}
									<div
										className={cn(
											'max-w-[80%] sm:max-w-[75%]',
										)}
									>
										<div
											className={cn(
												'rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
												isUser
													? 'bg-primary text-primary-foreground rounded-tr-sm'
													: isError
														? 'bg-destructive/10 text-destructive rounded-tl-sm border border-destructive/20'
														: 'bg-muted text-foreground rounded-tl-sm',
											)}
										>
											<p className='whitespace-pre-wrap break-words'>{msg.content}</p>
										</div>
										<div
											className={cn(
												'flex items-center gap-1 mt-0.5',
												isUser ? 'justify-end' : 'justify-start',
											)}
										>
											<span className='text-[10px] text-muted-foreground'>
												{formatTime(msg.timestamp)}
											</span>
										</div>
									</div>
								</div>
							)
						})}

						{loading && !messages.some((m) => m.role === 'assistant' && m.content === '') && (
							<TypingIndicator />
						)}

						<div ref={messagesEndRef} />
					</div>
				</ScrollArea>

				{/* Error Banner */}
				{error && (
					<div className='px-4 py-2 bg-destructive/10 border-t border-destructive/20 flex items-center justify-between gap-2 shrink-0'>
						<p className='text-xs text-destructive flex-1 truncate'>{error}</p>
						<Button
							variant='ghost'
							size='sm'
							className='h-6 w-6 p-0 shrink-0 text-destructive'
							onClick={dismissError}
						>
							<X className='h-3 w-3' />
						</Button>
					</div>
				)}

				{/* Input Area */}
				<div className='px-3 py-3 border-t bg-card/50 shrink-0'>
					<div className='flex items-end gap-2'>
						<Textarea
							ref={textareaRef}
							value={inputText}
							onChange={(e) => setInputText(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder='Ask me anything...'
							rows={1}
							className='min-h-[40px] max-h-[120px] resize-none py-2.5 text-sm'
							disabled={loading}
						/>
						<div className='flex flex-col gap-1 shrink-0'>
							<Button
								onClick={handleSend}
								disabled={!inputText.trim() || loading}
								size='sm'
								className='h-9 w-9 p-0 bg-black hover:bg-black/90 text-white'
							>
								<Send className='h-4 w-4' />
							</Button>
						</div>
					</div>
					<div className='flex items-center justify-between mt-2 px-0.5'>
						<span className='text-[10px] text-muted-foreground'>
							Press Enter to send, Shift+Enter for new line
						</span>
						{messages.length > 0 && (
							<Button
								variant='ghost'
								size='sm'
								className='h-6 px-2 text-[10px] text-muted-foreground hover:text-destructive gap-1'
								onClick={clearHistory}
							>
								<Trash2 className='h-3 w-3' />
								Clear
							</Button>
						)}
					</div>
				</div>
			</div>

			{/* ─── Minimized Pill ───────────────────────────────── */}
			{isMinimized && (
				<button
					onClick={handleRestore}
					className={cn(
						'flex items-center gap-2 px-4 py-2.5 bg-black text-white rounded-full shadow-lg',
						'hover:bg-black/90 transition-all duration-200 animate-in fade-in slide-in-from-bottom-2',
					)}
				>
					<Bot className='h-4 w-4' />
					<span className='text-sm font-medium'>AI Assistant</span>
					<div className='h-2 w-2 rounded-full bg-green-400' />
				</button>
			)}

			{/* ─── FAB Button ───────────────────────────────────── */}
			{(isClosed || isMinimized) && (
				<button
					onClick={handleOpen}
					className={cn(
						'h-14 w-14 rounded-full bg-black text-white shadow-lg flex items-center justify-center',
						'hover:scale-105 active:scale-95 transition-all duration-200 ease-out',
						'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
						isClosed && 'animate-in fade-in zoom-in',
					)}
					aria-label='Open AI Assistant'
					title='AI Assistant'
				>
					<Bot className='h-6 w-6' />
				</button>
			)}
		</div>
	)
}
