import { useCallback, useEffect, useRef, useState } from 'react';
import { apiCall } from '@/lib/api';

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	timestamp: number;
}

export interface ChatContext {
	page: string;
	path: string;
}

interface ChatResponse {
	message: string;
}

const STORAGE_KEY = 'rekrutai_ai_chat_history';
const MAX_MESSAGES = 100;

function loadMessagesFromStorage(): ChatMessage[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as ChatMessage[];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function saveMessagesToStorage(messages: ChatMessage[]) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)));
	} catch {
		// localStorage may be full or unavailable
	}
}

export function useAIChat(context?: ChatContext) {
	const [messages, setMessages] = useState<ChatMessage[]>(loadMessagesFromStorage);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	// Persist messages to localStorage
	useEffect(() => {
		saveMessagesToStorage(messages);
	}, [messages]);

	const sendMessage = useCallback(
		async (content: string) => {
			if (!content.trim()) return;

			const userMessage: ChatMessage = {
				id: `user-${Date.now()}`,
				role: 'user',
				content: content.trim(),
				timestamp: Date.now(),
			};

			setMessages((prev) => [...prev, userMessage]);
			setLoading(true);
			setError(null);

			// Create a placeholder assistant message
			const assistantId = `assistant-${Date.now()}`;
			const placeholder: ChatMessage = {
				id: assistantId,
				role: 'assistant',
				content: '',
				timestamp: Date.now(),
			};
			setMessages((prev) => [...prev, placeholder]);

			try {
				const response = await apiCall<ChatResponse>('/ai/chat', {
					method: 'POST',
					body: {
						message: userMessage.content,
						context: context || undefined,
					},
				});

				setMessages((prev) =>
					prev.map((msg) =>
						msg.id === assistantId
							? { ...msg, content: response.message || 'No response received.' }
							: msg,
					),
				);
			} catch (err) {
				const errorMessage =
					err instanceof Error ? err.message : 'Something went wrong. Please try again.';
				setError(errorMessage);
				// Update placeholder with error
				setMessages((prev) =>
					prev.map((msg) =>
						msg.id === assistantId ? { ...msg, content: `❌ ${errorMessage}` } : msg,
					),
				);
			} finally {
				setLoading(false);
			}
		},
		[context],
	);

	const clearHistory = useCallback(() => {
		setMessages([]);
		setError(null);
		try {
			localStorage.removeItem(STORAGE_KEY);
		} catch {
			// ignore
		}
	}, []);

	const dismissError = useCallback(() => {
		setError(null);
	}, []);

	return {
		messages,
		loading,
		error,
		sendMessage,
		clearHistory,
		dismissError,
	};
}
