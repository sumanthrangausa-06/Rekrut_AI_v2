import { useEffect, useRef, useState, useCallback } from 'react'
import { apiCall } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Send, Paperclip, Phone, Video, MoreVertical, ArrowLeft, User, Bot,
  Clock, Check, CheckCheck, FileText, Image, File, Smile, X,
  Sparkles, Loader2, MessageSquare,
} from 'lucide-react'

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
  return new Date(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
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

// ─── Main Component ───────────────────────────────────────
export function ChatPage({ mode }: { mode: 'candidate' | 'recruiter' }) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConv, setActiveConv] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showMobileSidebar, setShowMobileSidebar] = useState(true)
  const [typingUsers, setTypingUsers] = useState<Set<number>>(new Set())
  const [showProfilePanel, setShowProfilePanel] = useState(false)
  const [sharedFiles, setSharedFiles] = useState<{name: string; type: string; size: string; date: string}[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

  // Load conversations
  useEffect(() => {
    loadConversations()
  }, [mode])

  // Load messages when conversation changes
  useEffect(() => {
    if (activeConv) {
      loadMessages(activeConv)
      // On mobile, hide sidebar when conversation opens
      if (isMobile) setShowMobileSidebar(false)
    }
  }, [activeConv])

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Poll for new messages
  useEffect(() => {
    if (!activeConv) return
    const interval = setInterval(() => {
      pollNewMessages(activeConv)
    }, 5000)
    return () => clearInterval(interval)
  }, [activeConv, messages.length])

  // Simulate typing indicator for demo
  useEffect(() => {
    if (!activeConv) return
    const timer = setTimeout(() => {
      const conv = conversations.find(c => c.id === activeConv)
      if (conv && Math.random() > 0.7) {
        setTypingUsers(prev => new Set([...prev, conv.other_user?.id || 0]))
        setTimeout(() => {
          setTypingUsers(prev => {
            const next = new Set(prev)
            next.delete(conv.other_user?.id || 0)
            return next
          })
        }, 2000)
      }
    }, 3000)
    return () => clearTimeout(timer)
  }, [activeConv, messages])

  async function loadConversations() {
    setLoading(true)
    try {
      const endpoint = mode === 'candidate' ? '/candidate/conversations' : '/recruiter/conversations'
      const data = await apiCall<any>(endpoint)
      const convs = data.conversations || data || []
      setConversations(convs)
      if (convs.length > 0 && !activeConv) {
        setActiveConv(convs[0].id)
      }
    } catch {
      // Mock data for demo
      setConversations(getMockConversations(mode))
      if (!activeConv) setActiveConv(1)
    } finally {
      setLoading(false)
    }
  }

  async function loadMessages(convId: number) {
    try {
      const data = await apiCall<any>(`/conversations/${convId}/messages`)
      setMessages(data.messages || data || [])
    } catch {
      setMessages(getMockMessages(convId, mode))
    }
  }

  async function pollNewMessages(convId: number) {
    try {
      const data = await apiCall<any>(`/conversations/${convId}/messages?after=${messages.length > 0 ? messages[messages.length - 1].id : 0}`)
      const newMessages = data.messages || data || []
      if (newMessages.length > 0) {
        setMessages(prev => [...prev, ...newMessages])
      }
    } catch {
      // silent fail on polling
    }
  }

  async function sendMessage() {
    if (!inputText.trim() || !activeConv) return
    const text = inputText.trim()
    setInputText('')
    setSending(true)

    // Optimistic add
    const optimisticMsg: ChatMessage = {
      id: Date.now(),
      conversation_id: activeConv,
      sender_id: 0, // self
      content: text,
      type: 'text',
      created_at: new Date().toISOString(),
      is_read: false,
    }
    setMessages(prev => [...prev, optimisticMsg])

    try {
      await apiCall(`/conversations/${activeConv}/messages`, {
        method: 'POST',
        body: { content: text, type: 'text' },
      })
      // Refresh to get real message
      await loadMessages(activeConv)
    } catch {
      // Keep optimistic message if API fails
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
      created_at: new Date().toISOString(),
      is_read: false,
    }
    setMessages(prev => [...prev, optimisticMsg])

    // Add to shared files list
    setSharedFiles(prev => [...prev, {
      name: file.name,
      type: file.type.startsWith('image/') ? 'image' : 'pdf',
      size: `${(file.size / 1024).toFixed(1)} KB`,
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }])

    try {
      const formData = new FormData()
      formData.append('file', file)
      await apiCall(`/conversations/${activeConv}/upload`, {
        method: 'POST',
        body: formData,
      })
    } catch {
      // Keep optimistic message
    } finally {
      setSending(false)
    }
  }

  async function startCall(type: 'audio' | 'video') {
    if (!activeConv) return
    // Show call notification
    const callMsg: ChatMessage = {
      id: Date.now(),
      conversation_id: activeConv,
      sender_id: 0,
      content: `Started a ${type} call`,
      type: 'system',
      created_at: new Date().toISOString(),
      is_read: false,
    }
    setMessages(prev => [...prev, callMsg])
  }

  async function markAsRead(convId: number) {
    try {
      await apiCall(`/conversations/${convId}/read`, { method: 'POST' })
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, unread_count: 0 } : c))
    } catch { }
  }

  const filteredConversations = conversations.filter(c => {
    const otherName = mode === 'candidate' ? c.recruiter_name : c.candidate_name
    const search = searchQuery.toLowerCase()
    return !search ||
      otherName?.toLowerCase().includes(search) ||
      c.job_title?.toLowerCase().includes(search) ||
      c.company_name?.toLowerCase().includes(search) ||
      c.last_message?.content?.toLowerCase().includes(search)
  })

  const activeConversation = conversations.find(c => c.id === activeConv)
  const groupedMessages = groupMessagesByDate(messages)
  const otherUser = activeConversation?.other_user || {
    name: mode === 'candidate' ? activeConversation?.recruiter_name : activeConversation?.candidate_name,
    role: mode === 'candidate' ? 'Recruiter' : 'Candidate',
    is_online: false,
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col -mx-4 -mt-4 sm:-mx-6 sm:-mt-6 lg:-mx-8">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-card/50 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          <h1 className="font-heading text-lg font-bold">Messages</h1>
          <Badge variant="secondary" className="text-[10px]">
            {conversations.filter(c => c.unread_count > 0).length} unread
          </Badge>
        </div>
      </div>

      {/* Chat Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar — Conversations List */}
        <div className={`${showMobileSidebar ? 'flex' : 'hidden'} md:flex w-full md:w-80 border-r flex-col bg-card/30 shrink-0`}>
          {/* Search + New */}
          <div className="p-3 border-b">
            <div className="flex gap-2 mb-2">
              <div className="relative flex-1">
                <MessageSquare className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search conversations..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-9 h-9 text-sm"
                />
              </div>
              <Button variant="outline" size="sm" className="h-9 px-2 gap-1 text-xs" onClick={() => {
                if (conversations.length > 0) {
                  setActiveConversation(conversations[0].id)
                }
              }}>
                <User className="h-3.5 w-3.5" />
                New
              </Button>
            </div>
          </div>

          {/* Conversations */}
          <ScrollArea className="flex-1">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No conversations yet
              </div>
            ) : (
              <div className="divide-y">
                {filteredConversations.map(conv => {
                  const isActive = conv.id === activeConv
                  const otherName = mode === 'candidate' ? conv.recruiter_name : conv.candidate_name
                  const otherRole = mode === 'candidate' ? 'Recruiter' : 'Candidate'
                  return (
                    <button
                      key={conv.id}
                      onClick={() => { setActiveConv(conv.id); markAsRead(conv.id) }}
                      className={`w-full text-left p-3 transition-colors hover:bg-muted/50 ${
                        isActive ? 'bg-primary/5 border-l-2 border-l-primary' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="relative shrink-0">
                          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                            {otherName?.[0]?.toUpperCase() || '?'}
                          </div>
                          {conv.other_user?.is_online && (
                            <div className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-background" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm truncate">{otherName}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0 ml-1">
                              {conv.last_message && formatTime(conv.last_message.created_at)}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {conv.job_title && <span className="text-primary/70">{conv.job_title} · </span>}
                            {conv.last_message?.content || 'No messages yet'}
                          </p>
                        </div>
                        {conv.unread_count > 0 && (
                          <div className="h-5 min-w-[1.25rem] rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center px-1.5 shrink-0">
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

        {/* Main Chat Area */}
        <div className={`${showMobileSidebar ? 'hidden' : 'flex'} md:flex flex-1 flex-col bg-background`}>
          {activeConversation ? (
            <>
              {/* Chat Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b bg-card/50 shrink-0">
                <div className="flex items-center gap-3">
                  <Button variant="ghost" size="sm" className="md:hidden h-8 w-8 p-0" onClick={() => setShowMobileSidebar(true)}>
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div className="relative">
                    <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                      {otherUser?.name?.[0]?.toUpperCase() || '?'}
                    </div>
                    {otherUser?.is_online && (
                      <div className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-background" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{otherUser?.name || 'Unknown'}</span>
                      <Badge variant="outline" className="text-[10px] h-4">
                        {otherUser?.role || (mode === 'candidate' ? 'Recruiter' : 'Candidate')}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {activeConversation.job_title && `Re: ${activeConversation.job_title}`}
                      {activeConversation.company_name && ` · ${activeConversation.company_name}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => startCall('audio')} title="Audio call">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => startCall('video')} title="Video call">
                    <Video className="h-4 w-4 text-muted-foreground" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setShowProfilePanel(!showProfilePanel)} title="Contact info">
                    <MoreVertical className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              </div>

              {/* Messages Area */}
              <ScrollArea className="flex-1 px-4 py-4" ref={scrollAreaRef}>
                <div className="space-y-6">
                  {groupedMessages.map((group, gi) => (
                    <div key={gi}>
                      {/* Date separator */}
                      <div className="flex items-center justify-center mb-4">
                        <div className="bg-muted px-3 py-1 rounded-full text-[10px] text-muted-foreground font-medium">
                          {group.date}
                        </div>
                      </div>

                      <div className="space-y-3">
                        {group.messages.map((msg, mi) => {
                          const isSelf = msg.sender_id === 0 || msg.sender?.role === 'candidate' && mode === 'candidate' || msg.sender?.role === 'recruiter' && mode === 'recruiter'
                          const showAvatar = mi === 0 || group.messages[mi - 1].sender_id !== msg.sender_id
                          return (
                            <div key={msg.id} className={`flex gap-2 ${isSelf ? 'flex-row-reverse' : ''}`}>
                              {showAvatar && !isSelf && (
                                <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0 mt-1">
                                  {msg.sender?.name?.[0]?.toUpperCase() || otherUser?.name?.[0]?.toUpperCase() || '?'}
                                </div>
                              )}
                              <div className={`max-w-[75%] ${showAvatar && !isSelf ? 'ml-0' : 'ml-9'} ${isSelf ? 'mr-0' : ''}`}>
                                <div className={`rounded-2xl px-3.5 py-2.5 text-sm ${
                                  isSelf
                                    ? 'bg-primary text-primary-foreground rounded-tr-sm'
                                    : 'bg-muted rounded-tl-sm'
                                }`}>
                                  {msg.type === 'text' && <p className="whitespace-pre-wrap">{msg.content}</p>}
                                  {msg.type === 'file' && (
                                    <div className="flex items-center gap-2">
                                      <File className="h-4 w-4 shrink-0" />
                                      <span className="truncate">{msg.file_name || 'File'}</span>
                                    </div>
                                  )}
                                  {msg.type === 'image' && (
                                    <div className="flex items-center gap-2">
                                      <Image className="h-4 w-4 shrink-0" />
                                      <span className="truncate">{msg.file_name || 'Image'}</span>
                                    </div>
                                  )}
                                  {msg.type === 'system' && (
                                    <div className="flex items-center gap-1.5 text-xs opacity-70">
                                      <Sparkles className="h-3 w-3" />
                                      {msg.content}
                                    </div>
                                  )}
                                </div>
                                <div className={`flex items-center gap-1 mt-0.5 ${isSelf ? 'justify-end' : ''}`}>
                                  <span className="text-[10px] text-muted-foreground">{formatTime(msg.created_at)}</span>
                                  {isSelf && (
                                    <span className="text-[10px] text-muted-foreground">
                                      {msg.is_read ? (
                                        <CheckCheck className="h-3 w-3 text-blue-500" />
                                      ) : (
                                        <Check className="h-3 w-3" />
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
                  {typingUsers.size > 0 && (
                    <div className="flex gap-2">
                      <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                        {otherUser?.name?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          <div className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '0ms' }} />
                          <div className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '150ms' }} />
                          <div className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* Input Area */}
              <div className="px-4 py-3 border-t bg-card/50 shrink-0">
                <div className="flex items-end gap-2">
                  <Button variant="ghost" size="sm" className="h-9 w-9 p-0 shrink-0" onClick={() => fileInputRef.current?.click()} title="Attach file">
                    <Paperclip className="h-4 w-4 text-muted-foreground" />
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) sendFile(file)
                      e.target.value = ''
                    }}
                  />
                  <div className="flex-1 relative">
                    <Input
                      ref={inputRef}
                      value={inputText}
                      onChange={e => setInputText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          sendMessage()
                        }
                      }}
                      placeholder="Type a message..."
                      className="pr-10 h-10 resize-none"
                    />
                    <Button variant="ghost" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0">
                      <Smile className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                  <Button
                    onClick={sendMessage}
                    disabled={!inputText.trim() || sending}
                    size="sm"
                    className="h-10 w-10 p-0 shrink-0"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {/* Profile Panel */}
              {showProfilePanel && activeConversation && otherUser && (
                <div className="w-72 border-l bg-muted/30 flex flex-col shrink-0">
                  <div className="p-4 border-b">
                    <div className="flex items-center justify-between mb-4">
                      <span className="font-semibold text-sm">Contact Info</span>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowProfilePanel(false)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex flex-col items-center">
                      <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary mb-2">
                        {otherName?.[0]?.toUpperCase() || '?'}
                      </div>
                      <span className="font-medium text-sm">{otherName}</span>
                      <span className="text-xs text-muted-foreground">{otherUser.email}</span>
                      <div className="flex items-center gap-1 mt-2">
                        <div className={`h-2 w-2 rounded-full ${otherUser.is_online ? 'bg-green-500' : 'bg-gray-400'}`} />
                        <span className="text-xs text-muted-foreground">{otherUser.is_online ? 'Online' : 'Offline'}</span>
                      </div>
                    </div>
                  </div>
                  <div className="p-4 border-b">
                    <span className="font-semibold text-sm">Shared Files</span>
                    <div className="mt-2 space-y-2">
                      {sharedFiles.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">No files shared yet</p>
                      ) : (
                        sharedFiles.map((file, i) => (
                          <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-background border">
                            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium truncate">{file.name}</p>
                              <p className="text-[10px] text-muted-foreground">{file.type} · {file.size}</p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="p-4">
                    <span className="font-semibold text-sm">About</span>
                    <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                      {mode === 'recruiter' 
                        ? `Candidate for ${activeConversation.job_title || 'this position'}. Connected via Rekrut AI.`
                        : `Recruiter at ${activeConversation.company_name || 'this company'}. Hiring for ${activeConversation.job_title || 'this position'}.`}
                    </p>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">Select a conversation to start messaging</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Mock Data ──────────────────────────────────────────────
function getMockConversations(mode: 'candidate' | 'recruiter'): Conversation[] {
  if (mode === 'candidate') {
    return [
      {
        id: 1, recruiter_name: 'Sarah Chen', recruiter_id: 101,
        job_title: 'Senior React Developer', job_id: 1, company_name: 'TechCorp',
        unread_count: 2, is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        last_message: { id: 1, conversation_id: 1, sender_id: 101, content: 'Thanks for applying! We would love to schedule an interview with you. Are you available next Tuesday at 2 PM?', type: 'text', created_at: new Date(Date.now() - 3600000).toISOString(), is_read: false } as ChatMessage,
        other_user: { id: 101, name: 'Sarah Chen', email: 'sarah@techcorp.com', role: 'recruiter', is_online: true }
      },
      {
        id: 2, recruiter_name: 'James Wilson', recruiter_id: 102,
        job_title: 'Product Manager', job_id: 2, company_name: 'InnovateLabs',
        unread_count: 0, is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        last_message: { id: 2, conversation_id: 2, sender_id: 0, content: 'I am very interested in this role. My experience with user research and agile teams aligns well with your requirements.', type: 'text', created_at: new Date(Date.now() - 86400000).toISOString(), is_read: true } as ChatMessage,
        other_user: { id: 102, name: 'James Wilson', email: 'james@innovatelabs.com', role: 'recruiter', is_online: false }
      },
      {
        id: 3, recruiter_name: 'Emily Park', recruiter_id: 103,
        job_title: 'UX Designer', job_id: 3, company_name: 'DesignStudio',
        unread_count: 1, is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        last_message: { id: 3, conversation_id: 3, sender_id: 103, content: 'Your portfolio looks amazing! Can you walk us through your design process for the mobile app redesign?', type: 'text', created_at: new Date(Date.now() - 7200000).toISOString(), is_read: false } as ChatMessage,
        other_user: { id: 103, name: 'Emily Park', email: 'emily@designstudio.com', role: 'recruiter', is_online: true }
      },
      {
        id: 4, recruiter_name: 'Michael Torres', recruiter_id: 104,
        job_title: 'Data Engineer', job_id: 4, company_name: 'DataFlow',
        unread_count: 0, is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        last_message: { id: 4, conversation_id: 4, sender_id: 104, content: 'We have received your application. The hiring team will review it and get back to you within 5 business days.', type: 'text', created_at: new Date(Date.now() - 172800000).toISOString(), is_read: true } as ChatMessage,
        other_user: { id: 104, name: 'Michael Torres', email: 'michael@dataflow.com', role: 'recruiter', is_online: false }
      },
      {
        id: 5, recruiter_name: 'Lisa Anderson', recruiter_id: 105,
        job_title: 'DevOps Engineer', job_id: 5, company_name: 'CloudScale',
        unread_count: 0, is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        last_message: { id: 5, conversation_id: 5, sender_id: 0, content: 'Thank you for the opportunity. I have a few questions about the team structure and tech stack.', type: 'text', created_at: new Date(Date.now() - 259200000).toISOString(), is_read: true } as ChatMessage,
        other_user: { id: 105, name: 'Lisa Anderson', email: 'lisa@cloudscale.com', role: 'recruiter', is_online: true }
      },
    ]
  }

  return [
    {
      id: 1, candidate_name: 'Alex Johnson', candidate_id: 201,
      job_title: 'Senior React Developer', job_id: 1, company_name: 'TechCorp',
      unread_count: 1, is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      last_message: { id: 1, conversation_id: 1, sender_id: 201, content: 'I am very excited about this opportunity! I have 5 years of React experience and have led a team of 3 developers at my current company.', type: 'text', created_at: new Date(Date.now() - 3600000).toISOString(), is_read: false } as ChatMessage,
      other_user: { id: 201, name: 'Alex Johnson', email: 'alex@email.com', role: 'candidate', is_online: true }
    },
    {
      id: 2, candidate_name: 'Maria Garcia', candidate_id: 202,
      job_title: 'Product Manager', job_id: 2, company_name: 'InnovateLabs',
      unread_count: 0, is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      last_message: { id: 2, conversation_id: 2, sender_id: 0, content: 'Thank you for your application. We would like to schedule a screening call. Are you available this week?', type: 'text', created_at: new Date(Date.now() - 86400000).toISOString(), is_read: true } as ChatMessage,
      other_user: { id: 202, name: 'Maria Garcia', email: 'maria@email.com', role: 'candidate', is_online: false }
    },
    {
      id: 3, candidate_name: 'David Kim', candidate_id: 203,
      job_title: 'Data Engineer', job_id: 4, company_name: 'DataFlow',
      unread_count: 2, is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      last_message: { id: 3, conversation_id: 3, sender_id: 203, content: 'I have experience with Spark, Kafka, and Airflow. Would these skills be relevant for the data pipeline work you mentioned?', type: 'text', created_at: new Date(Date.now() - 7200000).toISOString(), is_read: false } as ChatMessage,
      other_user: { id: 203, name: 'David Kim', email: 'david@email.com', role: 'candidate', is_online: true }
    },
    {
      id: 4, candidate_name: 'Rachel Green', candidate_id: 204,
      job_title: 'UX Designer', job_id: 3, company_name: 'DesignStudio',
      unread_count: 0, is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      last_message: { id: 4, conversation_id: 4, sender_id: 0, content: 'Your portfolio is impressive. We would love to see you in action — can you do a quick design challenge?', type: 'text', created_at: new Date(Date.now() - 172800000).toISOString(), is_read: true } as ChatMessage,
      other_user: { id: 204, name: 'Rachel Green', email: 'rachel@email.com', role: 'candidate', is_online: false }
    },
  ]
}

function getMockMessages(convId: number, mode: 'candidate' | 'recruiter'): ChatMessage[] {
  const now = Date.now()
  const base: ChatMessage[] = []

  if (convId === 1) {
    base.push(
      { id: 1, conversation_id: 1, sender_id: mode === 'candidate' ? 101 : 201, content: 'Hi! I saw your application for the Senior React Developer role. Your profile looks promising.', type: 'text', created_at: new Date(now - 86400000 * 3).toISOString(), is_read: true },
      { id: 2, conversation_id: 1, sender_id: 0, content: 'Thank you! I am very excited about this opportunity. I have been working with React for 5 years and recently moved into leading a small team.', type: 'text', created_at: new Date(now - 86400000 * 3 + 600000).toISOString(), is_read: true },
      { id: 3, conversation_id: 1, sender_id: mode === 'candidate' ? 101 : 201, content: 'That is great to hear. Can you tell me more about your experience with TypeScript and state management libraries?', type: 'text', created_at: new Date(now - 86400000 * 2).toISOString(), is_read: true },
      { id: 4, conversation_id: 1, sender_id: 0, content: 'Absolutely. We use TypeScript extensively and I have worked with both Redux and Zustand. For complex state, I prefer Zustand with Immer for immutability. I also have experience with React Query for server state.', type: 'text', created_at: new Date(now - 86400000 * 2 + 900000).toISOString(), is_read: true },
      { id: 5, conversation_id: 1, sender_id: mode === 'candidate' ? 101 : 201, content: 'Excellent. We are actually migrating from Redux to Zustand right now, so your experience is very relevant. Are you familiar with performance optimization techniques like code splitting and lazy loading?', type: 'text', created_at: new Date(now - 86400000).toISOString(), is_read: true },
      { id: 6, conversation_id: 1, sender_id: 0, content: 'Yes, I have implemented route-based code splitting with React.lazy and Suspense. I also use React.memo strategically and have experience with virtualization for large lists using react-window.', type: 'text', created_at: new Date(now - 86400000 + 1200000).toISOString(), is_read: true },
      { id: 7, conversation_id: 1, sender_id: mode === 'candidate' ? 101 : 201, content: 'This is exactly what we are looking for! We would love to schedule an interview with you. Are you available next Tuesday at 2 PM?', type: 'text', created_at: new Date(now - 3600000).toISOString(), is_read: false },
    )
  } else if (convId === 2) {
    base.push(
      { id: 1, conversation_id: 2, sender_id: mode === 'candidate' ? 102 : 202, content: 'Hello! Thank you for your interest in the Product Manager position at InnovateLabs.', type: 'text', created_at: new Date(now - 86400000 * 5).toISOString(), is_read: true },
      { id: 2, conversation_id: 2, sender_id: 0, content: 'Thank you for reaching out. I have been following InnovateLabs for a while and am impressed by your product direction.', type: 'text', created_at: new Date(now - 86400000 * 5 + 300000).toISOString(), is_read: true },
      { id: 3, conversation_id: 2, sender_id: mode === 'candidate' ? 102 : 202, content: 'We are glad to hear that! What attracts you most to this role specifically?', type: 'text', created_at: new Date(now - 86400000 * 4).toISOString(), is_read: true },
      { id: 4, conversation_id: 2, sender_id: 0, content: 'I am very interested in this role. My experience with user research and agile teams aligns well with your requirements. I have also led cross-functional teams to launch 3 successful products in the past 2 years.', type: 'text', created_at: new Date(now - 86400000).toISOString(), is_read: true },
    )
  } else if (convId === 3) {
    base.push(
      { id: 1, conversation_id: 3, sender_id: mode === 'candidate' ? 103 : 203, content: 'Hi there! Your application for the Data Engineer role caught our attention.', type: 'text', created_at: new Date(now - 86400000 * 2).toISOString(), is_read: true },
      { id: 2, conversation_id: 3, sender_id: 0, content: 'I am glad to hear that! I have been working with data pipelines for 4 years and am excited about the scale of data you mentioned.', type: 'text', created_at: new Date(now - 86400000 * 2 + 600000).toISOString(), is_read: true },
      { id: 3, conversation_id: 3, sender_id: mode === 'candidate' ? 103 : 203, content: 'Can you walk us through a complex data pipeline you have designed? We are particularly interested in real-time processing.', type: 'text', created_at: new Date(now - 86400000).toISOString(), is_read: true },
      { id: 4, conversation_id: 3, sender_id: 0, content: 'I built a real-time event processing pipeline that handles 50k events per second using Kafka, Spark Streaming, and Delta Lake. It processes clickstream data for an e-commerce platform with sub-5s latency.', type: 'text', created_at: new Date(now - 86400000 + 1800000).toISOString(), is_read: true },
      { id: 5, conversation_id: 3, sender_id: mode === 'candidate' ? 103 : 203, content: 'That is impressive! I have experience with Spark, Kafka, and Airflow. Would these skills be relevant for the data pipeline work you mentioned?', type: 'text', created_at: new Date(now - 7200000).toISOString(), is_read: false },
    )
  } else {
    base.push(
      { id: 1, conversation_id: convId, sender_id: mode === 'candidate' ? 104 + convId : 200 + convId, content: 'Hello! Thank you for your interest in our position.', type: 'text', created_at: new Date(now - 86400000).toISOString(), is_read: true },
      { id: 2, conversation_id: convId, sender_id: 0, content: 'Thank you! I am excited about the opportunity.', type: 'text', created_at: new Date(now - 86400000 + 600000).toISOString(), is_read: true },
    )
  }

  return base
}
