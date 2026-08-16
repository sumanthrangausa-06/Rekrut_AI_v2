import {
	ArrowLeft,
	Check,
	CheckCheck,
	Download,
	File,
	FileText,
	Image,
	Loader2,
	MessageSquare,
	MoreVertical,
	Paperclip,
	Phone,
	Search,
	Send,
	User,
	Video,
	X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar } from '@/components/ui/avatar'
import { apiCall } from '@/lib/api'

// ─── Types ──────────────────────────────────────────────────
interface ChatUser {
	id: number
	name: string
	email: string
	avatar_url?: string
	role: string
	is_online?: boolean
	last_seen?: string
}

interface ChatMessage {
	id: number
	conversation_id: number
	sender_id: number
	content: string
	type: 'text' | 'file' | 'image' | 'system'
	file_url?: string
	file_name?: string
	file_size?: number
	created_at: string
	read_at?: string
	is_read: boolean
	sender?: ChatUser
}

interface Conversation {
	id: number
	job_id?: number
	job_title?: string
	candidate_id?: number
	candidate_name?: string
	recruiter_id?: number
	recruiter_name?: string
	company_name?: string
	last_message?: ChatMessage
	unread_count: number
	is_active: boolean
	created_at: string
	updated_at: string
	other_user?: ChatUser
}

// ─── Quick Reply Templates ──────────────────────────────────
const CANDIDATE_QUICK_REPLIES = [
	"Thanks for reaching out!",
	"I'm interested in this role",
	"When can we schedule a call?",
	"Can you share more details?",
	"I've attached my updated resume",
	"What is the salary range?",
]

const RECRUITER_QUICK_REPLIES = [
	"Thanks for your interest!",
	"Can we schedule a call this week?",
	"Please share your portfolio",
	"What is your expected salary?",
	"We'd love to move forward",
	"Could you share your availability?",
]

// ─── Helpers ────────────────────────────────────────────────
function formatTime(d: string) {
	const date = new Date(d)
	const now = new Date()
	const isToday = date.toDateString() === now.toDateString()
	if (isToday) return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
	const isYesterday = new Date(now.getTime() - 86400000).toDateString() === date.toDateString()
	if (isYesterday) return 'Yesterday'
	return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatFullDate(d: string) {
	return new Date(d).toLocaleDateString('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		year: 'numeric',
	})
}

function formatFileSize(bytes?: number): string {
	if (!bytes) return ''
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function groupMessagesByDate(messages: ChatMessage[]) {
	const groups: { date: string; messages: ChatMessage[] }[] = []
	let currentDate = ''
	for (const msg of messages) {
		const date = new Date(msg.created_at).toDateString()
		if (date !== currentDate) {
			currentDate = date
			groups.push({ date: formatFullDate(msg.created_at), messages: [] })
		}
		groups[groups.length - 1].messages.push(msg)
	}
	return groups
}

function getFileIcon(type: string) {
	if (type === 'image') return <Image className='h-5 w-5 text-blue-500' />
	if (type === 'pdf') return <FileText className='h-5 w-5 text-red-500' />
	return <File className='h-5 w-5 text-muted-foreground' />
}

// ─── Highlight matched text ─────────────────────────────────
function HighlightText({ text, query }: { text: string; query: string }) {
	if (!query.trim()) return <>{text}</>
	const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, 'gi'))
	return (
		<>
			{parts.map((part, i) =>
				part.toLowerCase() === query.toLowerCase() ? (
					<mark key={i} className='bg-yellow-200 dark:bg-yellow-700 rounded px-0.5'>
						{part}
					</mark>
				) : (
					<span key={i}>{part}</span>
				),
			)}
		</>
	)
}

function escapeRegExp(s: string) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ─── File Card Component ────────────────────────────────────
function FileCard({ msg }: { msg: ChatMessage }) {
	const fileExt = msg.file_name?.split('.').pop()?.toLowerCase() || ''
	const isImage = msg.type === 'image' || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(fileExt)
	const isPdf = fileExt === 'pdf'

	return (
		<div className='flex items-center gap-3 p-3 rounded-xl bg-background/80 border shadow-sm min-w-[200px] max-w-[280px]'>
			<div className='h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0'>
				{isImage ? (
					<Image className='h-5 w-5 text-blue-500' />
				) : isPdf ? (
					<FileText className='h-5 w-5 text-red-500' />
				) : (
					<File className='h-5 w-5 text-muted-foreground' />
				)}
			</div>
			<div className='flex-1 min-w-0'>
				<p className='text-sm font-medium truncate'>{msg.file_name || 'File'}</p>
				<p className='text-[11px] text-muted-foreground'>
					{formatFileSize(msg.file_size)}
					{msg.file_url && (
						<span className='ml-2'>
							<a
								href={msg.file_url}
								target='_blank'
								rel='noopener noreferrer'
								className='text-primary hover:underline inline-flex items-center gap-0.5'
								onClick={(e) => e.stopPropagation()}
							>
								<Download className='h-3 w-3' />
								Download
							</a>
						</span>
					)}
				</p>
			</div>
		</div>
	)
}

// ─── Main Component ───────────────────────────────────────
export function ChatPage({ mode }: { mode: 'candidate' | 'recruiter' }) {
	const [conversations, setConversations] = useState<Conversation[]>([])
	const [activeConv, setActiveConv] = useState<number | null>(null)
	const [messages, setMessages] = useState<ChatMessage[]>([])
	const [inputText, setInputText] = useState('')
	const [loading, setLoading] = useState(true)
	const [sending, setSending] = useState(false)
	const [convSearchQuery, setConvSearchQuery] = useState('')
	const [msgSearchQuery, setMsgSearchQuery] = useState('')
	const [showMsgSearch, setShowMsgSearch] = useState(false)
	const [showMobileSidebar, setShowMobileSidebar] = useState(true)
	const [typingUsers, setTypingUsers] = useState<Set<number>>(new Set())
	const [showProfilePanel, setShowProfilePanel] = useState(false)
	const [sharedFiles, setSharedFiles] = useState<
		{ name: string; type: string; size: string; date: string }[]
	>([])
	const fileInputRef = useRef<HTMLInputElement>(null)
	const messagesEndRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)
	const scrollAreaRef = useRef<HTMLDivElement>(null)

	const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
	const quickReplies = mode === 'candidate' ? CANDIDATE_QUICK_REPLIES : RECRUITER_QUICK_REPLIES

	const loadConversations = useCallback(async () => {
		setLoading(true)
		try {
			const endpoint =
				mode === 'candidate' ? '/candidate/conversations' : '/recruiter/conversations'
			const data = await apiCall<any>(endpoint)
			const convs = data.conversations || data || []
			setConversations(convs)
			if (convs.length > 0 && !activeConv) {
				setActiveConv(convs[0].id)
			}
		} catch (err) {
			console.error('[chat] Failed to load conversations:', err)
			setConversations([])
		} finally {
			setLoading(false)
		}
	}, [mode, activeConv])

	const loadMessages = useCallback(async (convId: number) => {
		try {
			const data = await apiCall<any>(`/conversations/${convId}/messages`)
			setMessages(data.messages || data || [])
		} catch (err) {
			console.error('[chat] Failed to load messages:', err)
			setMessages([])
		}
	}, [])

	const pollNewMessages = useCallback(async (convId: number) => {
		try {
			const data = await apiCall<any>(
				`/conversations/${convId}/messages?after=${messages.length > 0 ? messages[messages.length - 1].id : 0}`,
			)
			const newMessages = data.messages || data || []
			if (newMessages.length > 0) {
				setMessages((prev) => [...prev, ...newMessages])
			}
		} catch (err) {
			console.error('[chat] Poll failed:', err)
		}
	}, [messages])

	// Load conversations
	useEffect(() => {
		loadConversations()
	}, [loadConversations])

	// Load messages when conversation changes
	useEffect(() => {
		if (activeConv) {
			loadMessages(activeConv)
			setMsgSearchQuery('')
			setShowMsgSearch(false)
			if (isMobile) setShowMobileSidebar(false)
		}
	}, [activeConv, isMobile, loadMessages])

	// Auto-scroll to bottom when messages change (not on search)
	useEffect(() => {
		if (!msgSearchQuery) {
			messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
		}
	}, [messages, msgSearchQuery])

	// Poll for new messages
	useEffect(() => {
		if (!activeConv) return
		const interval = setInterval(() => {
			pollNewMessages(activeConv)
		}, 5000)
		return () => clearInterval(interval)
	}, [activeConv, pollNewMessages])

	// Simulate typing indicator for demo
	useEffect(() => {
		if (!activeConv) return
		const timer = setTimeout(() => {
			const conv = conversations.find((c) => c.id === activeConv)
			if (conv && Math.random() > 0.7) {
				setTypingUsers((prev) => new Set([...prev, conv.other_user?.id || 0]))
				setTimeout(() => {
					setTypingUsers((prev) => {
						const next = new Set(prev)
						next.delete(conv.other_user?.id || 0)
						return next
					})
				}, 2000)
			}
		}, 3000)
		return () => clearTimeout(timer)
	}, [activeConv, conversations])

	async function sendMessage(textOverride?: string) {
		const text = (textOverride || inputText).trim()
		if (!text || !activeConv) return
		setInputText('')
		setSending(true)

		const optimisticMsg: ChatMessage = {
			id: Date.now(),
			conversation_id: activeConv,
			sender_id: 0,
			content: text,
			type: 'text',
			created_at: new Date().toISOString(),
			is_read: false,
		}
		setMessages((prev) => [...prev, optimisticMsg])

		try {
			await apiCall(`/conversations/${activeConv}/messages`, {
				method: 'POST',
				body: { content: text, type: 'text' },
			})
			await loadMessages(activeConv)
		} catch (err) {
			console.error('[chat] Failed to send message:', err)
		} finally {
			setSending(false)
			inputRef.current?.focus()
		}
	}

	async function sendFile(file: File) {
		if (!activeConv || !file) return
		setSending(true)

		const type = file.type.startsWith('image/') ? 'image' : 'file'
		const optimisticMsg: ChatMessage = {
			id: Date.now(),
			conversation_id: activeConv,
			sender_id: 0,
			content: `Sent ${type}: ${file.name}`,
			type,
			file_name: file.name,
			file_size: file.size,
			created_at: new Date().toISOString(),
			is_read: false,
		}
		setMessages((prev) => [...prev, optimisticMsg])

		setSharedFiles((prev) => [
			...prev,
			{
				name: file.name,
				type: file.type.startsWith('image/') ? 'image' : 'pdf',
				size: formatFileSize(file.size),
				date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
			},
		])

		try {
			const formData = new FormData()
			formData.append('file', file)
			await apiCall(`/conversations/${activeConv}/upload`, {
				method: 'POST',
				body: formData,
				isFormData: true,
			})
		} catch (err) {
			console.error('[chat] Failed to send file:', err)
		} finally {
			setSending(false)
		}
	}

	async function startCall(type: 'audio' | 'video') {
		if (!activeConv) return
		const callMsg: ChatMessage = {
			id: Date.now(),
			conversation_id: activeConv,
			sender_id: 0,
			content: `Started a ${type} call`,
			type: 'system',
			created_at: new Date().toISOString(),
			is_read: false,
		}
		setMessages((prev) => [...prev, callMsg])
	}

	async function markAsRead(convId: number) {
		try {
			await apiCall(`/conversations/${convId}/read`, { method: 'POST' })
			setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, unread_count: 0 } : c)))
		} catch (err) {
			console.error('[chat] Operation failed:', err)
		}
	}

	const filteredConversations = conversations.filter((c) => {
		const otherName = mode === 'candidate' ? c.recruiter_name : c.candidate_name
		const search = convSearchQuery.toLowerCase()
		return (
			!search ||
			otherName?.toLowerCase().includes(search) ||
			c.job_title?.toLowerCase().includes(search) ||
			c.company_name?.toLowerCase().includes(search) ||
			c.last_message?.content?.toLowerCase().includes(search)
		)
	})

	// Client-side message search
	const filteredMessages = useMemo(() => {
		if (!msgSearchQuery.trim()) return messages
		const q = msgSearchQuery.toLowerCase()
		return messages.filter((m) =>
			m.type === 'text' && m.content.toLowerCase().includes(q)
		)
	}, [messages, msgSearchQuery])

	const activeConversation = conversations.find((c) => c.id === activeConv)
	const groupedMessages = groupMessagesByDate(filteredMessages)
	const otherUser = activeConversation?.other_user || {
		name:
			mode === 'candidate'
				? activeConversation?.recruiter_name
				: activeConversation?.candidate_name,
		role: mode === 'candidate' ? 'Recruiter' : 'Candidate',
		is_online: false,
		email: '',
		id: 0,
	}

	// Determine if sidebar should be shown on mobile
	const sidebarVisible = isMobile ? showMobileSidebar : true
	const chatVisible = isMobile ? !showMobileSidebar : true

	return (
		<div className='h-[calc(100vh-8rem)] flex flex-col -mx-4 -mt-4 sm:-mx-6 sm:-mt-6 lg:-mx-8'>
			{/* Header */}
			<div className='flex items-center justify-between px-4 py-3 border-b bg-card/50 backdrop-blur-sm shrink-0'>
				<div className='flex items-center gap-2'>
					<MessageSquare className='h-5 w-5 text-primary' />
					<h1 className='font-heading text-lg font-bold'>Messages</h1>
					{conversations.filter((c) => c.unread_count > 0).length > 0 && (
						<Badge variant='secondary' className='text-[10px]'>
							{conversations.filter((c) => c.unread_count > 0).length} unread
						</Badge>
					)}
				</div>
			</div>

			{/* Chat Layout */}
			<div className='flex-1 flex overflow-hidden'>
				{/* Sidebar — Conversations List */}
				{sidebarVisible && (
					<div className='w-full md:w-80 border-r flex flex-col bg-card/30 shrink-0'>
						{/* Search + New */}
						<div className='p-3 border-b'>
							<div className='flex gap-2 mb-2'>
								<div className='relative flex-1'>
									<Search className='absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground' />
									<Input
										placeholder='Search conversations...'
										value={convSearchQuery}
										onChange={(e) => setConvSearchQuery(e.target.value)}
										className='pl-9 h-9 text-sm'
									/>
								</div>
								<Button
									variant='outline'
									size='sm'
									className='h-9 px-2 gap-1 text-xs'
									onClick={() => {
										if (conversations.length > 0) {
											setActiveConv(conversations[0].id)
										}
									}}
								>
									<User className='h-3.5 w-3.5' />
									New
								</Button>
							</div>
						</div>

						{/* Conversations */}
						<ScrollArea className='flex-1'>
							{loading ? (
								<div className='flex items-center justify-center py-8'>
									<Loader2 className='h-5 w-5 animate-spin text-muted-foreground' />
								</div>
							) : filteredConversations.length === 0 ? (
								<div className='p-8 text-center'>
									<MessageSquare className='h-10 w-10 mx-auto text-muted-foreground/30 mb-3' />
									<p className='text-sm text-muted-foreground mb-2'>No conversations yet</p>
									<p className='text-xs text-muted-foreground/70 mb-4'>
										{mode === 'candidate'
											? 'Apply to jobs to start chatting with recruiters'
											: 'Candidates will appear here when they apply to your jobs'}
									</p>
									<Button
										size='sm'
										variant='outline'
										onClick={() => {
											window.location.href = mode === 'candidate' ? '/jobs' : '/recruiter/jobs'
										}}
									>
										{mode === 'candidate' ? 'Browse Jobs' : 'Post a Job'}
									</Button>
								</div>
							) : (
								<div className='divide-y divide-border/50'>
									{filteredConversations.map((conv) => {
										const isActive = conv.id === activeConv
										const otherName =
											mode === 'candidate' ? conv.recruiter_name : conv.candidate_name
										return (
											<button
												key={conv.id}
												onClick={() => {
													setActiveConv(conv.id)
													markAsRead(conv.id)
												}}
												className={`w-full text-left p-3 transition-colors hover:bg-muted/50 ${
													isActive ? 'bg-primary/5 border-l-2 border-l-primary' : ''
												}`}
											>
												<div className='flex items-start gap-3'>
													<div className='relative shrink-0'>
														<div className='h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary'>
															{otherName?.[0]?.toUpperCase() || '?'}
														</div>
														{conv.other_user?.is_online && (
															<div className='absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-background' />
														)}
													</div>
													<div className='flex-1 min-w-0'>
														<div className='flex items-center justify-between gap-2'>
															<span className='font-medium text-sm truncate'>
																{otherName}
															</span>
															<span className='text-[10px] text-muted-foreground shrink-0'>
																{conv.last_message && formatTime(conv.last_message.created_at)}
															</span>
														</div>
														<p className='text-[11px] text-muted-foreground truncate mt-0.5'>
															{conv.job_title && (
																<span className='text-primary/70'>{conv.job_title} · </span>
															)}
															{conv.last_message?.content || 'No messages yet'}
														</p>
													</div>
													{conv.unread_count > 0 && (
														<div className='h-5 min-w-[1.25rem] rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center px-1.5 shrink-0 mt-0.5'>
															{conv.unread_count}
														</div>
													)}
												</div>
											</button>
										)
									})}
								</div>
							)}
						</ScrollArea>
					</div>
				)}

				{/* Main Chat Area */}
				{chatVisible && (
					<div className='flex-1 flex flex-col bg-background min-w-0'>
						{activeConversation ? (
							<>
								{/* Chat Header */}
								<div className='flex items-center justify-between px-4 py-3 border-b bg-card/50 shrink-0 gap-2'>
									<div className='flex items-center gap-3 min-w-0'>
										<Button
											variant='ghost'
											size='sm'
											className='md:hidden h-8 w-8 p-0 shrink-0'
											onClick={() => setShowMobileSidebar(true)}
										>
											<ArrowLeft className='h-4 w-4' />
										</Button>
										<div className='relative shrink-0'>
											<div className='h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary'>
												{otherUser?.name?.[0]?.toUpperCase() || '?'}
											</div>
											{otherUser?.is_online && (
												<div className='absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-background' />
											)}
										</div>
										<div className='min-w-0'>
											<div className='flex items-center gap-2'>
												<span className='font-semibold text-sm truncate'>
													{otherUser?.name || 'Unknown'}
												</span>
												<Badge variant='outline' className='text-[10px] h-4 shrink-0'>
													{otherUser?.role || (mode === 'candidate' ? 'Recruiter' : 'Candidate')}
												</Badge>
											</div>
											<p className='text-[11px] text-muted-foreground truncate'>
												{activeConversation.job_title && `Re: ${activeConversation.job_title}`}
												{activeConversation.company_name &&
													` · ${activeConversation.company_name}`}
											</p>
										</div>
									</div>
									<div className='flex items-center gap-1 shrink-0'>
										{/* Message search toggle */}
										{showMsgSearch ? (
											<div className='flex items-center gap-1'>
												<Input
													autoFocus
													placeholder='Search messages...'
													value={msgSearchQuery}
													onChange={(e) => setMsgSearchQuery(e.target.value)}
													className='h-8 w-40 md:w-56 text-sm'
												/>
												<Button
													variant='ghost'
													size='sm'
													className='h-8 w-8 p-0'
													onClick={() => {
														setShowMsgSearch(false)
														setMsgSearchQuery('')
													}}
												>
													<X className='h-4 w-4' />
												</Button>
											</div>
										) : (
											<Button
												variant='ghost'
												size='sm'
												className='h-8 w-8 p-0'
												onClick={() => setShowMsgSearch(true)}
												title='Search messages'
											>
												<Search className='h-4 w-4 text-muted-foreground' />
											</Button>
										)}
										<Button
											variant='ghost'
											size='sm'
											className='h-8 w-8 p-0 hidden sm:flex'
											onClick={() => startCall('audio')}
											title='Audio call'
										>
											<Phone className='h-4 w-4 text-muted-foreground' />
										</Button>
										<Button
											variant='ghost'
											size='sm'
											className='h-8 w-8 p-0 hidden sm:flex'
											onClick={() => startCall('video')}
											title='Video call'
										>
											<Video className='h-4 w-4 text-muted-foreground' />
										</Button>
										<Button
											variant='ghost'
											size='sm'
											className='h-8 w-8 p-0 hidden md:flex'
											onClick={() => setShowProfilePanel(!showProfilePanel)}
											title='Contact info'
										>
											<MoreVertical className='h-4 w-4 text-muted-foreground' />
										</Button>
									</div>
								</div>

								{/* Messages Area */}
								<ScrollArea className='flex-1 px-4 py-4' ref={scrollAreaRef}>
									<div className='space-y-6'>
										{msgSearchQuery && filteredMessages.length === 0 && (
											<div className='text-center py-8'>
												<p className='text-sm text-muted-foreground'>
													No messages match "{msgSearchQuery}"
												</p>
											</div>
										)}

										{groupedMessages.map((group) => (
											<div key={group.date}>
												{/* Date separator */}
												<div className='flex items-center justify-center mb-4'>
													<div className='bg-muted px-3 py-1 rounded-full text-[10px] text-muted-foreground font-medium'>
														{group.date}
													</div>
												</div>

												<div className='space-y-1'>
													{group.messages.map((msg, mi) => {
														const isSelf =
															msg.sender_id === 0 ||
															(msg.sender?.role === 'candidate' &&
																mode === 'candidate') ||
															(msg.sender?.role === 'recruiter' &&
																mode === 'recruiter')
														const prevMsg = mi > 0 ? group.messages[mi - 1] : null
														const showAvatar =
															!isSelf &&
															(!prevMsg || prevMsg.sender_id !== msg.sender_id)
														const isFirstInGroup =
															!prevMsg || prevMsg.sender_id !== msg.sender_id

														return (
															<div
																key={msg.id}
																className={`flex gap-2 ${isSelf ? 'flex-row-reverse' : ''}`}
															>
																{showAvatar ? (
																	<Avatar
																		className='h-7 w-7 shrink-0 mt-1'
																		seed={msg.sender_id || otherUser?.id}
																		fallback={msg.sender?.name?.[0]?.toUpperCase() || otherUser?.name?.[0]?.toUpperCase() || '?'}
																		useDiceBear={true}
																	/>
																) : (
																	!isSelf && <div className='w-7 shrink-0' />
																)}
																<div
																	className={`max-w-[80%] md:max-w-[70%] ${
																		isFirstInGroup ? '' : isSelf ? 'mr-9' : 'ml-9'
																	}`}
																>
																	{/* Sender name for group chats */}
																	{showAvatar && !isSelf && msg.sender?.name && (
																		<p className='text-[10px] text-muted-foreground mb-0.5 ml-1'>
																			{msg.sender.name}
																		</p>
																	)}
																	<div
																		className={`rounded-2xl px-4 py-2.5 text-sm ${
																			isSelf
																				? 'bg-primary text-primary-foreground rounded-tr-md'
																				: 'bg-muted rounded-tl-md'
																			} ${
																				msg.type === 'system'
																					? 'bg-muted/60 text-muted-foreground text-center mx-auto'
																					: ''
																			}`}
																	>
																		{msg.type === 'text' && (
																			<p className='whitespace-pre-wrap leading-relaxed'>
																			<HighlightText
																				text={msg.content}
																				query={msgSearchQuery}
																			/>
																		</p>
																		)}
																		{(msg.type === 'file' || msg.type === 'image') && (
																			<FileCard msg={msg} />
																		)}
																		{msg.type === 'system' && (
																			<div className='flex items-center justify-center gap-1.5 text-xs'>
																				{msg.content}
																			</div>
																		)}
																	</div>
																	<div
																		className={`flex items-center gap-1 mt-1 ${
																			isSelf ? 'justify-end mr-1' : 'ml-1'
																		}`}
																	>
																		<span className='text-[10px] text-muted-foreground'>
																			{formatTime(msg.created_at)}
																		</span>
																		{isSelf && (
																			<span>
																				{msg.is_read ? (
																					<CheckCheck className='h-3 w-3 text-blue-500' />
																				) : (
																					<Check className='h-3 w-3 text-muted-foreground' />
																				)}
																			</span>
																		)}
																	</div>
																</div>
															</div>
														)
													})}
											</div>
										</div>
									))}

										{/* Typing indicator */}
										{typingUsers.size > 0 && !msgSearchQuery && (
											<div className='flex gap-2'>
												<Avatar
													className='h-7 w-7 shrink-0'
													seed={otherUser?.id}
													fallback={otherUser?.name?.[0]?.toUpperCase() || '?'}
													useDiceBear={true}
												/>
												<div className='bg-muted rounded-2xl rounded-tl-md px-4 py-2.5'>
													<div className='flex items-center gap-1'>
														<div
															className='h-2 w-2 rounded-full bg-muted-foreground animate-bounce'
															style={{ animationDelay: '0ms' }}
														/>
														<div
															className='h-2 w-2 rounded-full bg-muted-foreground animate-bounce'
															style={{ animationDelay: '150ms' }}
														/>
														<div
															className='h-2 w-2 rounded-full bg-muted-foreground animate-bounce'
															style={{ animationDelay: '300ms' }}
														/>
													</div>
												</div>
											</div>
										)}

										<div ref={messagesEndRef} />
									</div>
								</ScrollArea>

								{/* Quick Replies */}
								{!msgSearchQuery && (
									<div className='px-4 pt-2 pb-1 shrink-0'>
										<div className='flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide'>
											{quickReplies.map((reply) => (
												<Button
													key={reply}
													variant='secondary'
													size='sm'
													className='h-7 text-xs whitespace-nowrap rounded-full px-3 shrink-0'
													onClick={() => {
														sendMessage(reply)
													}}
												>
													{reply}
												</Button>
											))}
										</div>
									</div>
								)}

									{/* Input Area */}
									<div className='px-4 py-3 border-t bg-card/50 shrink-0'>
										<div className='flex items-end gap-2'>
											<Button
												variant='ghost'
												size='sm'
												className='h-10 w-10 p-0 shrink-0 rounded-full'
												onClick={() => fileInputRef.current?.click()}
												title='Attach file'
											>
												<Paperclip className='h-4 w-4 text-muted-foreground' />
											</Button>
											<input
												ref={fileInputRef}
												type='file'
												accept='.pdf,.doc,.docx,.png,.jpg,.jpeg,.txt'
												className='hidden'
												onChange={(e) => {
													const file = e.target.files?.[0]
													if (file) sendFile(file)
													e.target.value = ''
												}}
											/>
											<div className='flex-1 relative'>
												<Input
													ref={inputRef}
													value={inputText}
													onChange={(e) => setInputText(e.target.value)}
													onKeyDown={(e) => {
														if (e.key === 'Enter' && !e.shiftKey) {
															e.preventDefault()
															sendMessage()
														}
													}}
													placeholder='Type a message...'
													className='pr-4 h-10 rounded-full bg-muted border-0 focus-visible:ring-1 focus-visible:ring-primary'
												/>
											</div>
											<Button
												onClick={() => sendMessage()}
												disabled={!inputText.trim() || sending}
												size='sm'
												className='h-10 w-10 p-0 shrink-0 rounded-full'
											>
												{sending ? (
													<Loader2 className='h-4 w-4 animate-spin' />
												) : (
													<Send className='h-4 w-4' />
												)}
											</Button>
										</div>
									</div>
								</>
							) : (
								<div className='flex-1 flex items-center justify-center'>
									<div className='text-center px-4'>
										<div className='h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4'>
											<MessageSquare className='h-8 w-8 text-muted-foreground/50' />
										</div>
										<p className='text-base font-medium text-foreground mb-1'>
											Select a conversation to start messaging
										</p>
										<p className='text-sm text-muted-foreground'>
											Choose a conversation from the sidebar to view messages
										</p>
									</div>
								</div>
							)}
						</div>
					)}

					{/* Profile Panel */}
					{showProfilePanel && activeConversation && otherUser && (
						<div className='w-72 border-l bg-muted/30 flex flex-col shrink-0 hidden lg:flex'>
							<div className='p-4 border-b'>
								<div className='flex items-center justify-between mb-4'>
									<span className='font-semibold text-sm'>Contact Info</span>
									<Button
										variant='ghost'
										size='sm'
										className='h-7 w-7 p-0'
										onClick={() => setShowProfilePanel(false)}
									>
										<X className='h-4 w-4' />
									</Button>
								</div>
								<div className='flex flex-col items-center'>
									<div className='h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary mb-2'>
										{otherUser?.name?.[0]?.toUpperCase() || '?'}
									</div>
									<span className='font-medium text-sm'>{otherUser?.name}</span>
									<span className='text-xs text-muted-foreground'>
										{otherUser?.email || ''}
									</span>
									<div className='flex items-center gap-1 mt-2'>
										<div
											className={`h-2 w-2 rounded-full ${otherUser.is_online ? 'bg-green-500' : 'bg-gray-400'}`}
										/>
										<span className='text-xs text-muted-foreground'>
											{otherUser.is_online ? 'Online' : 'Offline'}
										</span>
									</div>
								</div>
							</div>
							<div className='p-4 border-b'>
								<span className='font-semibold text-sm'>Shared Files</span>
								<div className='mt-2 space-y-2'>
									{sharedFiles.length === 0 ? (
										<p className='text-xs text-muted-foreground italic'>No files shared yet</p>
									) : (
										sharedFiles.map((file, i) => (
											<div
												key={i}
												className='flex items-center gap-2 p-2 rounded-lg bg-background border'
											>
												{getFileIcon(file.type)}
												<div className='min-w-0 flex-1'>
													<p className='text-xs font-medium truncate'>{file.name}</p>
													<p className='text-[10px] text-muted-foreground'>
														{file.type} · {file.size}
													</p>
												</div>
											</div>
										))
									)}
								</div>
							</div>
							<div className='p-4'>
								<span className='font-semibold text-sm'>About</span>
								<p className='mt-2 text-xs text-muted-foreground leading-relaxed'>
									{mode === 'recruiter'
										? `Candidate for ${activeConversation.job_title || 'this position'}. Connected via Rekrut AI.`
										: `Recruiter at ${activeConversation.company_name || 'this company'}. Hiring for ${activeConversation.job_title || 'this position'}.`}
								</p>
							</div>
						</div>
					)}
			</div>
		</div>
	)
}
