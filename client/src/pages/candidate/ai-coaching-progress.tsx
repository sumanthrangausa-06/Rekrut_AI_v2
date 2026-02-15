// Progress & History tabs for AI Coaching
// Extracted from ai-coaching.tsx for maintainability

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Brain, BarChart3, Clock, Eye, Volume2, History, ArrowRight,
  Video, FileText, Calendar, Star, Zap, MessageSquare, Mic,
  ChevronUp, ChevronDown, User, Monitor, Trophy, Sparkles, TrendingUp,
} from 'lucide-react'

import type {
  CategoryProgress, RecentSession, HistorySession, CategoryScoreDetail,
} from './coaching-types'
import {
  categoryConfig, difficultyColors,
  scoreColor, scoreBg, scoreLabel, ScoreBar,
} from './coaching-utils'


// ==================== Progress Tab ====================

interface ProgressTabProps {
  categoryProgress: CategoryProgress[]
  recentSessions: RecentSession[]
}

export function ProgressTab({ categoryProgress, recentSessions }: ProgressTabProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-5">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            Performance by Category
          </h3>
          {categoryProgress.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No practice sessions yet. Start practicing to see your progress!
            </p>
          ) : (
            <div className="space-y-4">
              {categoryProgress.map(cp => {
                const catCfg = categoryConfig[cp.category] || categoryConfig.behavioral
                const CatIcon = catCfg.icon
                const avgScore = parseFloat(String(cp.average_score)) || 0
                const pct = (avgScore / 10) * 100
                return (
                  <div key={cp.category} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 font-medium">
                        <CatIcon className={`h-4 w-4 ${catCfg.color}`} />
                        {catCfg.label}
                      </span>
                      <span className="text-muted-foreground">
                        {Math.round(avgScore * 10) / 10}/10 ({cp.count} sessions)
                      </span>
                    </div>
                    <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            Recent Practice Sessions
          </h3>
          {recentSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No practice sessions yet. Pick a question and start practicing!
            </p>
          ) : (
            <div className="space-y-3">
              {recentSessions.map((s, i) => {
                const catCfg = categoryConfig[s.category] || categoryConfig.behavioral
                return (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary/10 text-primary font-bold text-sm shrink-0">
                      {s.score}/10
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium line-clamp-1">{s.question}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <Badge variant="secondary" className={catCfg.bg + ' ' + catCfg.color + ' text-xs border-0'}>
                          {catCfg.label}
                        </Badge>
                        <span>{new Date(s.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}


// ==================== History Tab ====================

interface HistoryTabProps {
  historySessions: HistorySession[]
  historyTotal: number
  historyLoading: boolean
  historyFilter: string
  onFilterChange: (cat: string) => void
}

export function HistoryTab({ historySessions, historyTotal, historyLoading, historyFilter, onFilterChange }: HistoryTabProps) {
  const [reviewSession, setReviewSession] = useState<HistorySession | null>(null)
  const [reviewExpanded, setReviewExpanded] = useState<string | null>('content')

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Filter:</span>
        {['all', 'behavioral', 'technical', 'situational'].map(cat => (
          <button
            key={cat}
            onClick={() => onFilterChange(cat)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              historyFilter === cat
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted-foreground/10 text-muted-foreground'
            }`}
          >
            {cat === 'all' ? 'All' : categoryConfig[cat]?.label || cat}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">{historyTotal} session{historyTotal !== 1 ? 's' : ''}</span>
      </div>

      {historyLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading sessions...</div>
      ) : historySessions.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <History className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No coaching sessions yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Complete a mock interview to see your history here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {historySessions.map(session => {
            const catCfg = categoryConfig[session.category] || categoryConfig.behavioral
            const CatIcon = catCfg.icon
            const isVideo = session.response_type === 'video'
            const cd = session.coaching_data
            return (
              <Card
                key={session.id}
                className="cursor-pointer hover:border-primary/30 hover:shadow-sm transition-all"
                onClick={() => { setReviewSession(session); setReviewExpanded('content') }}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    {/* Score */}
                    <div className={`flex items-center justify-center h-12 w-12 rounded-xl border-2 shrink-0 ${scoreBg(session.score)}`}>
                      <span className={`text-lg font-bold ${scoreColor(session.score)}`}>{session.score}</span>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-snug line-clamp-2">{session.question}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <Badge variant="secondary" className={`${catCfg.bg} ${catCfg.color} text-xs border-0`}>
                          <CatIcon className="h-3 w-3 mr-1" /> {catCfg.label}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {isVideo ? <><Video className="h-3 w-3 mr-1" /> Video</> : <><FileText className="h-3 w-3 mr-1" /> Text</>}
                        </Badge>
                        {isVideo && cd?.content && (
                          <span className="text-[10px] text-muted-foreground">
                            Content {cd.content.score}/10 · Comm {cd.communication?.score || '?'}/10 · Pres {cd.presentation?.score || '?'}/10
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Date + arrow */}
                    <div className="text-right shrink-0">
                      <p className="text-xs text-muted-foreground">
                        {new Date(session.created_at).toLocaleDateString()}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {new Date(session.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <ArrowRight className="h-4 w-4 text-muted-foreground/50 mt-2 ml-auto" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* ==================== Session Review Dialog ==================== */}
      <Dialog open={!!reviewSession} onClose={() => setReviewSession(null)} className="max-w-2xl">
        <div className="max-h-[85vh] overflow-y-auto">
          {reviewSession && (() => {
            const cd = reviewSession.coaching_data
            const isMockInterview = reviewSession.question_id?.startsWith('mock-') || cd?.interview_readiness
            const isVideo = !isMockInterview && reviewSession.response_type === 'video' && cd?.content && cd?.communication && cd?.presentation
            const catCfg = categoryConfig[reviewSession.category] || categoryConfig.behavioral

            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    {isMockInterview
                      ? <><Trophy className="h-5 w-5 text-amber-500" /> Mock Interview Review</>
                      : <><History className="h-5 w-5 text-primary" /> Session Review</>
                    }
                  </DialogTitle>
                </DialogHeader>

                {/* Question / Session info */}
                <div className="mt-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Badge variant="secondary" className={`${catCfg.bg} ${catCfg.color} text-xs border-0`}>
                      {catCfg.label}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {isMockInterview ? 'Voice' : reviewSession.response_type === 'video' ? 'Video' : 'Text'}
                    </Badge>
                    <span className="text-xs text-muted-foreground ml-auto">
                      <Calendar className="h-3 w-3 inline mr-1" />
                      {new Date(reviewSession.created_at).toLocaleDateString()} at {new Date(reviewSession.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-sm font-medium">{reviewSession.question}</p>
                </div>

                {/* Overall Score */}
                <div className={`mt-3 text-center p-4 rounded-xl border-2 ${scoreBg(reviewSession.score)}`}>
                  <div className={`text-4xl font-bold ${scoreColor(reviewSession.score)}`}>
                    {reviewSession.score}/10
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {scoreLabel(reviewSession.score)} — Overall Score
                  </div>
                  {isMockInterview && cd?.interview_readiness && (
                    <Badge className={`mt-2 ${
                      cd.interview_readiness === 'ready' ? 'bg-green-100 text-green-700' :
                      cd.interview_readiness === 'almost_ready' ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-700'
                    } border-0`}>
                      {cd.interview_readiness === 'ready' ? 'Interview Ready' :
                       cd.interview_readiness === 'almost_ready' ? 'Almost Ready' : 'Needs Work'}
                    </Badge>
                  )}
                </div>

                {/* ==================== Mock Interview Full Feedback ==================== */}
                {isMockInterview && cd && (
                  <>
                    {/* Summary */}
                    {cd.summary && (
                      <div className="mt-3 p-3 rounded-lg bg-muted/30 border">
                        <p className="text-xs leading-relaxed">{cd.summary}</p>
                      </div>
                    )}

                    {/* Score bars for content/communication/presentation if available */}
                    {cd.content && cd.communication && (
                      <div className="mt-3 flex items-center justify-center gap-6 py-2">
                        <ScoreBar score={cd.content?._failed ? null : cd.content?.score} label="Answer Content" icon={Brain} />
                        <ScoreBar score={cd.communication?.score} label="Communication" icon={Volume2} />
                        <ScoreBar score={cd.presentation?.score || 5} label="Presentation" icon={Eye} />
                      </div>
                    )}

                    <div className="mt-3 space-y-2">
                      {/* Answer Content Section */}
                      {cd.content && (
                        <div className="border rounded-lg overflow-hidden">
                          <button onClick={() => setReviewExpanded(reviewExpanded === 'content' ? null : 'content')}
                            className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors">
                            <span className="flex items-center gap-2 font-medium text-sm">
                              <Brain className="h-4 w-4 text-violet-600" /> Answer Content
                              {cd.content._failed ? (
                                <span className="text-xs font-bold text-muted-foreground">Analysis failed</span>
                              ) : (
                                <span className={`text-xs font-bold ${scoreColor(cd.content.score)}`}>{cd.content.score}/10</span>
                              )}
                            </span>
                            {reviewExpanded === 'content' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </button>
                          {reviewExpanded === 'content' && (
                            <div className="p-3 pt-0 space-y-2.5">
                              {cd.content.detailed_feedback && (
                                <p className="text-xs leading-relaxed text-muted-foreground">{cd.content.detailed_feedback}</p>
                              )}
                              {cd.content.strengths?.length > 0 && (
                                <div className="p-3 rounded-lg bg-green-50 border border-green-100">
                                  <h5 className="text-xs font-semibold text-green-800 mb-1.5">✓ Strengths</h5>
                                  <ul className="space-y-1">{cd.content.strengths.map((s: string, i: number) => <li key={i} className="text-xs text-green-700">{s}</li>)}</ul>
                                </div>
                              )}
                              {cd.content.improvements?.length > 0 && (
                                <div className="p-3 rounded-lg bg-amber-50 border border-amber-100">
                                  <h5 className="text-xs font-semibold text-amber-800 mb-1.5">↑ Improve</h5>
                                  <ul className="space-y-1">{cd.content.improvements.map((s: string, i: number) => <li key={i} className="text-xs text-amber-700">{s}</li>)}</ul>
                                </div>
                              )}
                              {cd.content.specific_tips?.length > 0 && (
                                <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                                  <h5 className="text-xs font-semibold text-blue-800 mb-1.5">💡 Tips</h5>
                                  <ul className="space-y-1">{cd.content.specific_tips.map((s: string, i: number) => <li key={i} className="text-xs text-blue-700">{s}</li>)}</ul>
                                </div>
                              )}
                              {cd.content.common_mistake && (
                                <div className="p-3 rounded-lg bg-red-50 border border-red-100">
                                  <h5 className="text-xs font-semibold text-red-800 mb-1.5">⚠️ Common Mistake</h5>
                                  <p className="text-xs text-red-700">{cd.content.common_mistake}</p>
                                </div>
                              )}
                              <div className="grid grid-cols-2 gap-2">
                                {cd.content.star_method_usage && (
                                  <div className={`p-2.5 rounded-lg border ${scoreBg(cd.content.star_method_usage.score)}`}>
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-[10px] font-medium text-muted-foreground">STAR Method</span>
                                      <span className={`text-sm font-bold ${scoreColor(cd.content.star_method_usage.score)}`}>{cd.content.star_method_usage.score}/10</span>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground leading-relaxed">{cd.content.star_method_usage.feedback}</p>
                                  </div>
                                )}
                                {cd.content.technical_depth && (
                                  <div className={`p-2.5 rounded-lg border ${scoreBg(cd.content.technical_depth.score)}`}>
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-[10px] font-medium text-muted-foreground">Technical Depth</span>
                                      <span className={`text-sm font-bold ${scoreColor(cd.content.technical_depth.score)}`}>{cd.content.technical_depth.score}/10</span>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground leading-relaxed">{cd.content.technical_depth.feedback}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Communication & Speech Section */}
                      {cd.communication && (
                        <div className="border rounded-lg overflow-hidden">
                          <button onClick={() => setReviewExpanded(reviewExpanded === 'communication' ? null : 'communication')}
                            className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors">
                            <span className="flex items-center gap-2 font-medium text-sm">
                              <Volume2 className="h-4 w-4 text-sky-600" /> Communication & Speech
                              <span className={`text-xs font-bold ${scoreColor(cd.communication.score)}`}>{cd.communication.score}/10</span>
                            </span>
                            {reviewExpanded === 'communication' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </button>
                          {reviewExpanded === 'communication' && (
                            <div className="p-3 pt-0 space-y-2.5">
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                <div className="p-2 rounded bg-muted/50 text-center">
                                  <div className="text-lg font-bold">{cd.communication.words_per_minute || '\u2014'}</div>
                                  <div className="text-[10px] text-muted-foreground">Words/min</div>
                                </div>
                                <div className="p-2 rounded bg-muted/50 text-center">
                                  <div className="text-lg font-bold">{cd.communication.word_count || '\u2014'}</div>
                                  <div className="text-[10px] text-muted-foreground">Total Words</div>
                                </div>
                                <div className="p-2 rounded bg-muted/50 text-center">
                                  <div className="text-lg font-bold">{cd.communication.total_fillers || 0}</div>
                                  <div className="text-[10px] text-muted-foreground">Filler Words</div>
                                </div>
                                <div className="p-2 rounded bg-muted/50 text-center">
                                  <div className="text-lg font-bold">{cd.communication.duration_seconds ? `${Math.round(cd.communication.duration_seconds / 60)}:${String(cd.communication.duration_seconds % 60).padStart(2, '0')}` : '\u2014'}</div>
                                  <div className="text-[10px] text-muted-foreground">Duration</div>
                                </div>
                              </div>
                              {cd.communication.pace && (
                                <div className={`p-3 rounded-lg ${
                                  cd.communication.pace.assessment === 'good' ? 'bg-green-50 border border-green-100' :
                                  cd.communication.pace.assessment?.includes('slight') ? 'bg-amber-50 border border-amber-100' :
                                  'bg-red-50 border border-red-100'
                                }`}>
                                  <h5 className="text-xs font-semibold mb-1">🎙️ Speaking Pace</h5>
                                  <p className="text-xs">{cd.communication.pace.feedback}</p>
                                </div>
                              )}
                              {cd.communication.total_fillers > 0 && cd.communication.filler_words && (
                                <div className="p-3 rounded-lg bg-amber-50 border border-amber-100">
                                  <h5 className="text-xs font-semibold text-amber-800 mb-1.5">
                                    Filler Words ({cd.communication.filler_rate || 0}% of speech)
                                  </h5>
                                  <div className="flex flex-wrap gap-1.5">
                                    {Object.entries(cd.communication.filler_words).filter(([, count]) => (count as number) > 0).map(([word, count]) => (
                                      <Badge key={word} variant="outline" className="text-[10px] bg-white">
                                        "{word}" x {count as number}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {cd.communication.trends && (
                                <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-100">
                                  <h5 className="text-xs font-semibold text-indigo-800 mb-1">📈 Communication Trends</h5>
                                  <p className="text-xs text-indigo-700">{cd.communication.trends}</p>
                                </div>
                              )}
                              {cd.communication.tips?.length > 0 && (
                                <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                                  <h5 className="text-xs font-semibold text-blue-800 mb-1.5">💡 Speech Tips</h5>
                                  <ul className="space-y-1">{cd.communication.tips.map((t: string, i: number) => <li key={i} className="text-xs text-blue-700">{t}</li>)}</ul>
                                </div>
                              )}
                              {/* Voice Analysis */}
                              {cd.voice_analysis && (
                                <div className="space-y-2 pt-1">
                                  <h5 className="text-xs font-semibold flex items-center gap-1.5">
                                    <Mic className="h-3.5 w-3.5 text-indigo-600" /> Voice & Tone Analysis
                                  </h5>
                                  <div className="grid grid-cols-2 gap-2">
                                    {[
                                      { key: 'voice_confidence', label: 'Confidence', icon: Star },
                                      { key: 'vocal_variety', label: 'Vocal Variety', icon: Volume2 },
                                      { key: 'energy', label: 'Energy', icon: Zap },
                                      { key: 'articulation', label: 'Articulation', icon: MessageSquare },
                                    ].map(item => {
                                      const data = cd.voice_analysis?.[item.key]
                                      if (!data) return null
                                      const ItemIcon = item.icon
                                      return (
                                        <div key={item.key} className={`p-2.5 rounded-lg border ${scoreBg(data.score)}`}>
                                          <div className="flex items-center justify-between mb-1">
                                            <span className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                                              <ItemIcon className="h-3 w-3" /> {item.label}
                                            </span>
                                            <span className={`text-sm font-bold ${scoreColor(data.score)}`}>{data.score}/10</span>
                                          </div>
                                          <p className="text-[10px] text-muted-foreground leading-relaxed">{data.feedback}</p>
                                        </div>
                                      )
                                    })}
                                  </div>
                                  {cd.voice_analysis.voice_summary && (
                                    <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-100">
                                      <p className="text-xs text-indigo-700">{cd.voice_analysis.voice_summary}</p>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Body Language & Presentation */}
                      <div className="border rounded-lg overflow-hidden">
                        <button onClick={() => setReviewExpanded(reviewExpanded === 'presentation' ? null : 'presentation')}
                          className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors">
                          <span className="flex items-center gap-2 font-medium text-sm">
                            <Eye className="h-4 w-4 text-emerald-600" /> Body Language & Presentation
                            {cd.presentation ? (
                              <span className={`text-xs font-bold ${scoreColor(cd.presentation.score)}`}>{cd.presentation.score}/10</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">Not available</span>
                            )}
                          </span>
                          {reviewExpanded === 'presentation' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                        {reviewExpanded === 'presentation' && (
                          <div className="p-3 pt-0 space-y-2.5">
                            {cd.presentation ? (
                              <>
                                <div className="grid grid-cols-2 gap-2">
                                  {[
                                    { key: 'eye_contact', label: 'Eye Contact' },
                                    { key: 'facial_expressions', label: 'Expressions' },
                                    { key: 'body_language', label: 'Body Language' },
                                    { key: 'professional_appearance', label: 'Appearance' },
                                  ].map(item => {
                                    const data = cd.presentation?.[item.key]
                                    if (!data) return null
                                    return (
                                      <div key={item.key} className={`p-2.5 rounded-lg border ${scoreBg(data.score)}`}>
                                        <div className="flex items-center justify-between mb-1">
                                          <span className="text-[10px] font-medium text-muted-foreground">{item.label}</span>
                                          <span className={`text-sm font-bold ${scoreColor(data.score)}`}>{data.score}/10</span>
                                        </div>
                                        <p className="text-[10px] text-muted-foreground leading-relaxed">{data.feedback}</p>
                                      </div>
                                    )
                                  })}
                                </div>
                                {cd.presentation.summary && (
                                  <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                                    <h5 className="text-xs font-semibold text-emerald-800 mb-1">📊 Overall Assessment</h5>
                                    <p className="text-xs text-emerald-700">{cd.presentation.summary}</p>
                                  </div>
                                )}
                              </>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                Body language analysis requires camera access during the interview. Enable your camera next time for presentation feedback.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Interview Arc */}
                    {cd.interview_arc && (
                      <div className="mt-3 p-3 rounded-lg bg-muted/30 border">
                        <h4 className="text-xs font-semibold mb-1.5 flex items-center gap-1.5">
                          <TrendingUp className="h-3.5 w-3.5 text-primary" /> Overall Interview Arc
                        </h4>
                        <p className="text-xs leading-relaxed text-muted-foreground">{cd.interview_arc}</p>
                      </div>
                    )}

                    {/* Question-by-question scores */}
                    {cd.question_scores?.length > 0 && (
                      <div className="mt-3 border rounded-lg p-3">
                        <h4 className="text-xs font-semibold mb-2">Question-by-Question Scores</h4>
                        <div className="space-y-2">
                          {cd.question_scores.map((qs: any, i: number) => (
                            <div key={i} className="flex items-start gap-3 p-2 rounded-lg bg-muted/30">
                              <div className={`text-sm font-bold shrink-0 w-10 text-center ${scoreColor(qs.score)}`}>
                                {qs.score}/10
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium">{qs.question_summary}</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">{qs.feedback}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Fallback: show strengths/improvements if no structured content/communication sections */}
                    {!cd.content && !cd.communication && (
                      <div className="mt-3 space-y-2.5">
                        {cd.strengths?.length > 0 && (
                          <div className="p-3 rounded-lg bg-green-50 border border-green-100">
                            <h5 className="text-xs font-semibold text-green-800 mb-1.5">✓ Strengths</h5>
                            <ul className="space-y-1">{cd.strengths.map((s: string, i: number) => <li key={i} className="text-xs text-green-700">{s}</li>)}</ul>
                          </div>
                        )}
                        {cd.improvements?.length > 0 && (
                          <div className="p-3 rounded-lg bg-amber-50 border border-amber-100">
                            <h5 className="text-xs font-semibold text-amber-800 mb-1.5">↑ Areas for Improvement</h5>
                            <ul className="space-y-1">{cd.improvements.map((s: string, i: number) => <li key={i} className="text-xs text-amber-700">{s}</li>)}</ul>
                          </div>
                        )}
                        {/* Sub-scores from top-level SessionFeedback */}
                        {(cd.star_method_usage || cd.communication_quality || cd.technical_depth) && (
                          <div className="grid grid-cols-2 gap-2">
                            {cd.star_method_usage && cd.star_method_usage.score > 0 && (
                              <div className={`p-2.5 rounded-lg border ${scoreBg(cd.star_method_usage.score)}`}>
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-[10px] font-medium text-muted-foreground">STAR Method</span>
                                  <span className={`text-sm font-bold ${scoreColor(cd.star_method_usage.score)}`}>{cd.star_method_usage.score}/10</span>
                                </div>
                                <p className="text-[10px] text-muted-foreground leading-relaxed">{cd.star_method_usage.feedback}</p>
                              </div>
                            )}
                            {cd.communication_quality && cd.communication_quality.score > 0 && (
                              <div className={`p-2.5 rounded-lg border ${scoreBg(cd.communication_quality.score)}`}>
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-[10px] font-medium text-muted-foreground">Communication</span>
                                  <span className={`text-sm font-bold ${scoreColor(cd.communication_quality.score)}`}>{cd.communication_quality.score}/10</span>
                                </div>
                                <p className="text-[10px] text-muted-foreground leading-relaxed">{cd.communication_quality.feedback}</p>
                              </div>
                            )}
                            {cd.technical_depth && cd.technical_depth.score > 0 && (
                              <div className={`p-2.5 rounded-lg border ${scoreBg(cd.technical_depth.score)}`}>
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-[10px] font-medium text-muted-foreground">Technical Depth</span>
                                  <span className={`text-sm font-bold ${scoreColor(cd.technical_depth.score)}`}>{cd.technical_depth.score}/10</span>
                                </div>
                                <p className="text-[10px] text-muted-foreground leading-relaxed">{cd.technical_depth.feedback}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Top tip */}
                    {cd.top_tip && (
                      <div className="mt-3 p-3 rounded-xl bg-primary/5 border border-primary/10">
                        <h4 className="text-xs font-semibold flex items-center gap-1.5 mb-1">
                          <Sparkles className="h-3.5 w-3.5 text-primary" /> #1 Tip to Improve
                        </h4>
                        <p className="text-xs text-muted-foreground">{cd.top_tip}</p>
                      </div>
                    )}
                  </>
                )}

                {/* ==================== Video Coaching (Quick Practice) ==================== */}
                {isVideo && (
                  <>
                    <div className="mt-3 p-3 rounded-lg bg-muted/30 space-y-2.5">
                      <ScoreBar score={cd.content.score} label="Answer Content" icon={Brain} />
                      <ScoreBar score={cd.communication.score} label="Communication" icon={Volume2} />
                      <ScoreBar score={cd.presentation.score} label="Presentation" icon={Eye} />
                    </div>

                    <div className="mt-3 space-y-2">
                      {/* Content section */}
                      <div className="border rounded-lg overflow-hidden">
                        <button onClick={() => setReviewExpanded(reviewExpanded === 'content' ? null : 'content')}
                          className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors">
                          <span className="flex items-center gap-2 font-medium text-sm">
                            <Brain className="h-4 w-4 text-violet-600" /> Answer Content
                            <span className={`text-xs font-bold ${scoreColor(cd.content.score)}`}>{cd.content.score}/10</span>
                          </span>
                          {reviewExpanded === 'content' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                        {reviewExpanded === 'content' && (
                          <div className="p-3 pt-0 space-y-2.5">
                            {cd.content.strengths?.length > 0 && (
                              <div className="p-3 rounded-lg bg-green-50 border border-green-100">
                                <h5 className="text-xs font-semibold text-green-800 mb-1.5">✓ Strengths</h5>
                                <ul className="space-y-1">{cd.content.strengths.map((s: string, i: number) => <li key={i} className="text-xs text-green-700">{s}</li>)}</ul>
                              </div>
                            )}
                            {cd.content.improvements?.length > 0 && (
                              <div className="p-3 rounded-lg bg-amber-50 border border-amber-100">
                                <h5 className="text-xs font-semibold text-amber-800 mb-1.5">↑ Improve</h5>
                                <ul className="space-y-1">{cd.content.improvements.map((s: string, i: number) => <li key={i} className="text-xs text-amber-700">{s}</li>)}</ul>
                              </div>
                            )}
                            {cd.content.specific_tips?.length > 0 && (
                              <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                                <h5 className="text-xs font-semibold text-blue-800 mb-1.5">💡 Tips</h5>
                                <ul className="space-y-1">{cd.content.specific_tips.map((s: string, i: number) => <li key={i} className="text-xs text-blue-700">{s}</li>)}</ul>
                              </div>
                            )}
                            {cd.content.improved_response && (
                              <div className="p-3 rounded-lg bg-purple-50 border border-purple-100">
                                <h5 className="text-xs font-semibold text-purple-800 mb-1.5">⭐ Example Strong Response</h5>
                                <p className="text-xs text-purple-700 italic leading-relaxed">"{cd.content.improved_response}"</p>
                              </div>
                            )}
                            {cd.content.common_mistake && (
                              <div className="p-3 rounded-lg bg-red-50 border border-red-100">
                                <h5 className="text-xs font-semibold text-red-800 mb-1.5">⚠️ Common Mistake</h5>
                                <p className="text-xs text-red-700">{cd.content.common_mistake}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Communication section */}
                      <div className="border rounded-lg overflow-hidden">
                        <button onClick={() => setReviewExpanded(reviewExpanded === 'communication' ? null : 'communication')}
                          className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors">
                          <span className="flex items-center gap-2 font-medium text-sm">
                            <Volume2 className="h-4 w-4 text-sky-600" /> Communication & Speech
                            <span className={`text-xs font-bold ${scoreColor(cd.communication.score)}`}>{cd.communication.score}/10</span>
                          </span>
                          {reviewExpanded === 'communication' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                        {reviewExpanded === 'communication' && (
                          <div className="p-3 pt-0 space-y-2.5">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              <div className="p-2 rounded bg-muted/50 text-center">
                                <div className="text-lg font-bold">{cd.communication.words_per_minute}</div>
                                <div className="text-[10px] text-muted-foreground">Words/min</div>
                              </div>
                              <div className="p-2 rounded bg-muted/50 text-center">
                                <div className="text-lg font-bold">{cd.communication.word_count}</div>
                                <div className="text-[10px] text-muted-foreground">Total Words</div>
                              </div>
                              <div className="p-2 rounded bg-muted/50 text-center">
                                <div className="text-lg font-bold">{cd.communication.total_fillers}</div>
                                <div className="text-[10px] text-muted-foreground">Filler Words</div>
                              </div>
                              <div className="p-2 rounded bg-muted/50 text-center">
                                <div className="text-lg font-bold">{Math.round(cd.communication.duration_seconds / 60)}:{String(cd.communication.duration_seconds % 60).padStart(2, '0')}</div>
                                <div className="text-[10px] text-muted-foreground">Duration</div>
                              </div>
                            </div>
                            {cd.communication.pace && (
                              <div className={`p-3 rounded-lg ${
                                cd.communication.pace.assessment === 'good' ? 'bg-green-50 border border-green-100' :
                                cd.communication.pace.assessment?.includes('slight') ? 'bg-amber-50 border border-amber-100' :
                                'bg-red-50 border border-red-100'
                              }`}>
                                <h5 className="text-xs font-semibold mb-1">🎙️ Speaking Pace</h5>
                                <p className="text-xs">{cd.communication.pace.feedback}</p>
                              </div>
                            )}
                            {cd.communication.tips?.length > 0 && (
                              <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                                <h5 className="text-xs font-semibold text-blue-800 mb-1.5">💡 Speech Tips</h5>
                                <ul className="space-y-1">{cd.communication.tips.map((t: string, i: number) => <li key={i} className="text-xs text-blue-700">{t}</li>)}</ul>
                              </div>
                            )}
                            {cd.communication.voice_analysis && (
                              <div className="space-y-2 pt-1">
                                <h5 className="text-xs font-semibold flex items-center gap-1.5">
                                  <Mic className="h-3.5 w-3.5 text-indigo-600" /> Voice & Tone Analysis
                                </h5>
                                <div className="grid grid-cols-2 gap-2">
                                  {[
                                    { key: 'voice_confidence', label: 'Confidence', icon: Star },
                                    { key: 'vocal_variety', label: 'Vocal Variety', icon: Volume2 },
                                    { key: 'energy', label: 'Energy', icon: Zap },
                                    { key: 'articulation', label: 'Articulation', icon: MessageSquare },
                                  ].map(item => {
                                    const data = cd.communication.voice_analysis?.[item.key]
                                    if (!data) return null
                                    const ItemIcon = item.icon
                                    return (
                                      <div key={item.key} className={`p-2.5 rounded-lg border ${scoreBg(data.score)}`}>
                                        <div className="flex items-center justify-between mb-1">
                                          <span className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                                            <ItemIcon className="h-3 w-3" /> {item.label}
                                          </span>
                                          <span className={`text-sm font-bold ${scoreColor(data.score)}`}>{data.score}/10</span>
                                        </div>
                                        <p className="text-[10px] text-muted-foreground leading-relaxed">{data.feedback}</p>
                                      </div>
                                    )
                                  })}
                                </div>
                                {cd.communication.voice_analysis.voice_summary && (
                                  <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-100">
                                    <p className="text-xs text-indigo-700">{cd.communication.voice_analysis.voice_summary}</p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Presentation section */}
                      <div className="border rounded-lg overflow-hidden">
                        <button onClick={() => setReviewExpanded(reviewExpanded === 'presentation' ? null : 'presentation')}
                          className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors">
                          <span className="flex items-center gap-2 font-medium text-sm">
                            <Eye className="h-4 w-4 text-emerald-600" /> Body Language & Presentation
                            <span className={`text-xs font-bold ${scoreColor(cd.presentation.score)}`}>{cd.presentation.score}/10</span>
                          </span>
                          {reviewExpanded === 'presentation' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                        {reviewExpanded === 'presentation' && (
                          <div className="p-3 pt-0 space-y-2.5">
                            <div className="grid grid-cols-2 gap-2">
                              {[
                                { key: 'eye_contact', label: 'Eye Contact' },
                                { key: 'facial_expressions', label: 'Expressions' },
                                { key: 'body_language', label: 'Body Language' },
                                { key: 'professional_appearance', label: 'Appearance' },
                              ].map(item => {
                                const data = cd.presentation?.[item.key]
                                if (!data) return null
                                return (
                                  <div key={item.key} className={`p-2.5 rounded-lg border ${scoreBg(data.score)}`}>
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-[10px] font-medium text-muted-foreground">{item.label}</span>
                                      <span className={`text-sm font-bold ${scoreColor(data.score)}`}>{data.score}/10</span>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground leading-relaxed">{data.feedback}</p>
                                  </div>
                                )
                              })}
                            </div>
                            {cd.presentation.summary && (
                              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                                <h5 className="text-xs font-semibold text-emerald-800 mb-1">📊 Overall Assessment</h5>
                                <p className="text-xs text-emerald-700">{cd.presentation.summary}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {/* Text coaching: show simplified feedback */}
                {!isVideo && !isMockInterview && cd && (
                  <div className="mt-3 space-y-2.5">
                    {cd.strengths?.length > 0 && (
                      <div className="p-3 rounded-lg bg-green-50 border border-green-100">
                        <h5 className="text-xs font-semibold text-green-800 mb-1.5">✓ Strengths</h5>
                        <ul className="space-y-1">{cd.strengths.map((s: string, i: number) => <li key={i} className="text-xs text-green-700">{s}</li>)}</ul>
                      </div>
                    )}
                    {cd.improvements?.length > 0 && (
                      <div className="p-3 rounded-lg bg-amber-50 border border-amber-100">
                        <h5 className="text-xs font-semibold text-amber-800 mb-1.5">↑ Areas for Improvement</h5>
                        <ul className="space-y-1">{cd.improvements.map((s: string, i: number) => <li key={i} className="text-xs text-amber-700">{s}</li>)}</ul>
                      </div>
                    )}
                    {cd.specific_tips?.length > 0 && (
                      <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                        <h5 className="text-xs font-semibold text-blue-800 mb-1.5">💡 Tips</h5>
                        <ul className="space-y-1">{cd.specific_tips.map((s: string, i: number) => <li key={i} className="text-xs text-blue-700">{s}</li>)}</ul>
                      </div>
                    )}
                    {cd.improved_response && (
                      <div className="p-3 rounded-lg bg-purple-50 border border-purple-100">
                        <h5 className="text-xs font-semibold text-purple-800 mb-1.5">⭐ Example Strong Response</h5>
                        <p className="text-xs text-purple-700 italic leading-relaxed">"{cd.improved_response}"</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-4 flex gap-2">
                  <Button variant="outline" onClick={() => setReviewSession(null)} className="flex-1">Close</Button>
                </div>
              </>
            )
          })()}
        </div>
      </Dialog>
    </div>
  )
}
