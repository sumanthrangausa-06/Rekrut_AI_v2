// Shared types for AI Coaching features (Quick Practice, Mock Interview, Progress)
// Extracted from ai-coaching.tsx to reduce monolith and enable future component splitting

export interface PracticeQuestion {
  id: string
  category: string
  difficulty: string
  question: string
  key_points: string[]
  times_practiced: number
  last_score: number | null
  avg_score: number | null
  last_practiced: string | null
}

export interface PracticeStats {
  total_questions: number
  average_score: number | null
  improvement: number | null
  day_streak: number
  last_practice: string | null
}

export interface CategoryScoreDetail {
  score: number
  feedback: string
}

export interface VideoCoaching {
  overall_score: number
  content: {
    score: number
    strengths: string[]
    improvements: string[]
    covered_points: string[]
    missed_points: string[]
    detailed_feedback: string
    improved_response: string
    specific_tips: string[]
    common_mistake: string
    practice_prompt: string
  }
  communication: {
    score: number
    word_count: number
    words_per_minute: number
    duration_seconds: number
    filler_words: Record<string, number>
    total_fillers: number
    filler_rate: number
    pace: { assessment: string; wpm: number; feedback: string }
    tips: string[]
    voice_analysis?: {
      voice_confidence: { score: number; feedback: string }
      vocal_variety: { score: number; feedback: string }
      pacing_rhythm: { score: number; feedback: string }
      articulation: { score: number; feedback: string }
      energy: { score: number; feedback: string }
      overall_voice_score: number
      voice_summary: string
      voice_tips: string[]
    }
  }
  presentation: {
    score: number
    eye_contact: CategoryScoreDetail
    facial_expressions: CategoryScoreDetail
    body_language: CategoryScoreDetail
    professional_appearance: CategoryScoreDetail
    summary: string
    timestamped_notes: { frame: number; note: string }[]
  }
}

export interface TextCoaching {
  score: number
  strengths: string[]
  improvements: string[]
  specific_tips?: string[]
  improved_response?: string
  common_mistake?: string
  body_language_tips?: string[]
  practice_prompt?: string
}

export interface CategoryProgress {
  category: string
  count: number
  average_score: number
}

export interface RecentSession {
  question: string
  category: string
  score: number
  improvements: string[]
  created_at: string
}

export interface HistorySession {
  id: number
  question_id: string
  question: string
  category: string
  response_text: string
  score: number
  coaching_data: VideoCoaching | TextCoaching | any
  response_type: 'video' | 'text' | null
  transcription: string | null
  audio_analysis: any
  video_analysis: any
  duration_seconds: number | null
  created_at: string
}

export interface MockConversationTurn {
  role: 'interviewer' | 'candidate'
  text: string
  action?: string
  score_hint?: number
  notes?: string
  timestamp: string
}

export interface MockSession {
  id: number
  target_role: string
  job_description: string | null
  status: 'in_progress' | 'completed'
  conversation: MockConversationTurn[]
  current_question_index: number
  overall_score: number | null
  overall_feedback: any
  questions_asked: number
  follow_ups_asked: number
  started_at: string
  completed_at: string | null
}

export interface MockSessionSummary {
  id: number
  target_role: string
  status: string
  overall_score: number | null
  questions_asked: number
  follow_ups_asked: number
  started_at: string
  completed_at: string | null
  duration_minutes: number
  category_tags?: string[]
  interview_type?: string
}

export interface SessionFeedback {
  overall_score: number
  interview_readiness: string
  summary: string
  strengths: string[]
  improvements: string[]
  question_scores: { question_summary: string; score: number; feedback: string }[]
  star_method_usage: { score: number; feedback: string }
  communication_quality: { score: number; feedback: string }
  technical_depth: { score: number; feedback: string }
  top_tip: string
  presentation?: {
    score: number
    eye_contact: CategoryScoreDetail
    facial_expressions: CategoryScoreDetail
    body_language: CategoryScoreDetail
    professional_appearance: CategoryScoreDetail
    summary: string
  }
  voice_analysis?: {
    voice_confidence: { score: number; feedback: string }
    vocal_variety: { score: number; feedback: string }
    pacing_rhythm: { score: number; feedback: string }
    articulation: { score: number; feedback: string }
    energy: { score: number; feedback: string }
    overall_voice_score: number
    voice_summary: string
    voice_tips: string[]
  }
  confidence_score?: { score: number; feedback: string }
}
