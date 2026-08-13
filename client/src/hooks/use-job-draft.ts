import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { useDebounce } from './use-debounce'

export interface JobDraft {
	title: string
	company: string
	department: string
	description: string
	requirements: string
	location: string
	salaryRange: string
	jobType: string
	experienceLevel: string
	educationLevel: string
	screeningQuestions: Array<{
		id?: string
		question: string
		type: 'text' | 'yes_no' | 'select'
		required: boolean
		options?: string[]
		placeholder?: string
		category?: string
		isKnockout?: boolean
		knockoutAnswer?: string
	}>
	passThreshold: number
	countryCode: string
	currencyCode: string
	salaryMin: string
	salaryMax: string
	step: number
	visitedSteps: number[]
}

interface UseJobDraftReturn {
	draft: JobDraft | null
	saveDraft: (draft: JobDraft) => void
	loadDraft: () => JobDraft | null
	clearDraft: () => void
	hasDraft: boolean
	lastSavedAt: number | null
}

const DEBOUNCE_MS = 2000

function getStorageKey(userId: number | undefined): string {
	return `job-draft-${userId ?? 'anonymous'}`
}

export function useJobDraft(): UseJobDraftReturn {
	const { user } = useAuth()
	const userId = user?.id
	const [hasDraft, setHasDraft] = useState(() => {
		try {
			const key = getStorageKey(userId)
			return !!localStorage.getItem(key)
		} catch {
			return false
		}
	})
	const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
	const isRestoringRef = useRef(false)

	const storageKey = getStorageKey(userId)

	const persistDraft = useCallback((draft: JobDraft) => {
		if (isRestoringRef.current) return
		try {
			localStorage.setItem(storageKey, JSON.stringify(draft))
			setLastSavedAt(Date.now())
			setHasDraft(true)
		} catch {
			// localStorage may be full or disabled — silently fail
		}
	}, [storageKey])

	const debouncedPersist = useDebounce(persistDraft, DEBOUNCE_MS)

	const saveDraft = useCallback(
		(draft: JobDraft) => {
			debouncedPersist(draft)
		},
		[debouncedPersist],
	)

	const loadDraft = useCallback((): JobDraft | null => {
		try {
			const raw = localStorage.getItem(storageKey)
			if (!raw) return null
			const parsed = JSON.parse(raw) as JobDraft
			isRestoringRef.current = true
			// Reset the flag after a tick so subsequent saves work
			setTimeout(() => {
				isRestoringRef.current = false
			}, 100)
			return parsed
		} catch {
			return null
		}
	}, [storageKey])

	const clearDraft = useCallback(() => {
		try {
			localStorage.removeItem(storageKey)
			setHasDraft(false)
			setLastSavedAt(null)
		} catch {
			// silently fail
		}
	}, [storageKey])

	// Re-check hasDraft when user changes (login/logout)
	useEffect(() => {
		try {
			setHasDraft(!!localStorage.getItem(storageKey))
		} catch {
			setHasDraft(false)
		}
	}, [storageKey])

	return {
		draft: null,
		saveDraft,
		loadDraft,
		clearDraft,
		hasDraft,
		lastSavedAt,
	}
}
