import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  MessageSquare,
  Send,
  ArrowLeft,
  Mail,
  Phone,
  Inbox,
  Star,
  Trash2,
  Reply,
  CheckCircle2,
  Clock,
  AlertCircle,
  Search,
  Filter
} from 'lucide-react';

interface Message {
  id: number;
  sender: string;
  senderRole: string;
  subject: string;
  content: string;
  timestamp: string;
  read: boolean;
  starred: boolean;
  type: 'email' | 'sms' | 'in-app';
}

export function RecruiterCommunicationsPage() {
  const [activeTab, setActiveTab] = useState('inbox');
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [replyText, setReplyText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      sender: 'Alex Johnson',
      senderRole: 'Candidate',
      subject: 'Application for Senior Frontend Developer',
      content: 'Hi, I wanted to follow up on my application for the Senior Frontend Developer position. I am very excited about the opportunity and would love to discuss further.',
      timestamp: '2026-06-06T10:30:00Z',
      read: false,
      starred: true,
      type: 'email'
    },
    {
      id: 2,
      sender: 'Sarah Chen',
      senderRole: 'Candidate',
      subject: 'Interview Availability',
      content: 'Thank you for considering my application. I am available for an interview next week on Tuesday or Thursday between 2-5 PM. Please let me know what works best.',
      timestamp: '2026-06-05T16:45:00Z',
      read: true,
      starred: false,
      type: 'in-app'
    },
    {
      id: 3,
      sender: 'System',
      senderRole: 'System',
      subject: 'New Application Received',
      content: 'You have received a new application for the Backend Engineer position from Mike Williams. OmniScore: 85. Review recommended.',
      timestamp: '2026-06-05T09:00:00Z',
      read: true,
      starred: false,
      type: 'in-app'
    }
  ]);

  const handleReply = () => {
    if (!replyText.trim() || !selectedMessage) return;
    setReplyText('');
    setSelectedMessage(null);
  };

  const toggleStar = (id: number) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, starred: !m.starred } : m));
  };

  const markAsRead = (id: number) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, read: true } : m));
  };

  const deleteMessage = (id: number) => {
    setMessages(prev => prev.filter(m => m.id !== id));
    if (selectedMessage?.id === id) setSelectedMessage(null);
  };

  const filteredMessages = messages.filter(m => {
    if (activeTab === 'inbox') return true;
    if (activeTab === 'starred') return m.starred;
    if (activeTab === 'unread') return !m.read;
    return m.type === activeTab;
  }).filter(m => 
    m.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.sender.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <Link to="/recruiter/dashboard" className="text-gray-600 hover:text-gray-900 flex items-center gap-2 mb-4">
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <MessageSquare className="w-8 h-8 text-indigo-600" />
                Communications
              </h1>
              <p className="text-gray-600 mt-1">Manage all candidate and team communications</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-indigo-100 text-indigo-700">
                {messages.filter(m => !m.read).length} unread
              </Badge>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <Card className="mb-4">
              <CardContent className="pt-6">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="Search messages..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </CardContent>
            </Card>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="inbox">Inbox</TabsTrigger>
                <TabsTrigger value="starred">Starred</TabsTrigger>
              </TabsList>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="unread">Unread</TabsTrigger>
                <TabsTrigger value="email">Email</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="space-y-2 mt-4">
              {filteredMessages.length === 0 ? (
                <p className="text-center text-gray-500 py-8">No messages found</p>
              ) : (
                filteredMessages.map(message => (
                  <button
                    key={message.id}
                    onClick={() => {
                      setSelectedMessage(message);
                      markAsRead(message.id);
                    }}
                    className={`w-full text-left p-4 rounded-lg border transition hover:bg-gray-50 ${
                      selectedMessage?.id === message.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-white'
                    } ${!message.read ? 'border-l-4 border-l-indigo-500' : ''}`}
                  >
                    <div className="flex items-start justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{message.sender}</span>
                        {!message.read && (
                          <Badge className="bg-indigo-100 text-indigo-700 text-xs">New</Badge>
                        )}
                      </div>
                      <span className="text-xs text-gray-500">{formatTime(message.timestamp)}</span>
                    </div>
                    <p className="text-sm font-medium text-gray-800 mb-1">{message.subject}</p>
                    <p className="text-sm text-gray-600 line-clamp-2">{message.content}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className="text-xs">
                        {message.type === 'email' ? <Mail className="w-3 h-3 mr-1" /> : <MessageSquare className="w-3 h-3 mr-1" />}
                        {message.type}
                      </Badge>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleStar(message.id);
                        }}
                        className="p-1 hover:bg-gray-100 rounded"
                      >
                        <Star className={`w-4 h-4 ${message.starred ? 'text-yellow-400 fill-yellow-400' : 'text-gray-400'}`} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteMessage(message.id);
                        }}
                        className="p-1 hover:bg-gray-100 rounded"
                      >
                        <Trash2 className="w-4 h-4 text-gray-400" />
                      </button>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="lg:col-span-2">
            {selectedMessage ? (
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-xl mb-2">{selectedMessage.subject}</CardTitle>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <span className="font-medium">{selectedMessage.sender}</span>
                        <span>•</span>
                        <span>{selectedMessage.senderRole}</span>
                        <span>•</span>
                        <span>{formatTime(selectedMessage.timestamp)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleStar(selectedMessage.id)}
                        className="p-2 hover:bg-gray-100 rounded"
                      >
                        <Star className={`w-5 h-5 ${selectedMessage.starred ? 'text-yellow-400 fill-yellow-400' : 'text-gray-400'}`} />
                      </button>
                      <button
                        onClick={() => deleteMessage(selectedMessage.id)}
                        className="p-2 hover:bg-gray-100 rounded"
                      >
                        <Trash2 className="w-5 h-5 text-gray-400" />
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="bg-gray-50 p-4 rounded-lg mb-6">
                    <p className="text-gray-800 leading-relaxed">{selectedMessage.content}</p>
                  </div>

                  <div className="border-t pt-4">
                    <h3 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                      <Reply className="w-4 h-4" />
                      Reply
                    </h3>
                    <Textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder={`Reply to ${selectedMessage.sender}...`}
                      className="mb-3"
                      rows={4}
                    />
                    <div className="flex justify-end">
                      <Button onClick={handleReply} disabled={!replyText.trim()}>
                        <Send className="w-4 h-4 mr-2" />
                        Send Reply
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="flex items-center justify-center h-96 bg-white rounded-lg border border-gray-200">
                <div className="text-center">
                  <Inbox className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">Select a message to view and reply</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
