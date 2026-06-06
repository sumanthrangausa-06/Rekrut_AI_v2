import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Star,
  Send,
  ArrowLeft,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  User,
  Building2,
  Calendar,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

interface FeedbackForm {
  rating: number;
  hireQuality: number;
  communication: number;
  timeline: number;
  overallExperience: number;
  strengths: string;
  improvements: string;
  wouldRecommend: boolean | null;
  hireAgain: boolean | null;
}

export default function PostHireFeedbackPage() {
  const [submitted, setSubmitted] = useState(false);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [form, setForm] = useState<FeedbackForm>({
    rating: 0,
    hireQuality: 0,
    communication: 0,
    timeline: 0,
    overallExperience: 0,
    strengths: '',
    improvements: '',
    wouldRecommend: null,
    hireAgain: null
  });

  const handleStarClick = (field: keyof FeedbackForm, value: number) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = () => {
    if (form.rating === 0) return;
    setSubmitted(true);
  };

  const StarRating = ({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) => (
    <div className="mb-4">
      <Label className="text-sm font-medium text-gray-300 mb-2 block">{label}</Label>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => onChange(star)}
            onMouseEnter={() => setHoveredStar(star)}
            onMouseLeave={() => setHoveredStar(0)}
            className="p-1 hover:scale-110 transition-transform"
          >
            <Star
              className={`w-6 h-6 ${
                star <= (hoveredStar || value)
                  ? 'text-yellow-400 fill-yellow-400'
                  : 'text-gray-600'
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  );

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
        <Card className="max-w-md w-full bg-white/10 backdrop-blur-lg border-white/20">
          <CardContent className="pt-6 text-center">
            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8 text-green-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Thank You!</h2>
            <p className="text-gray-300 mb-6">
              Your feedback has been submitted successfully. It helps us improve the hiring experience for everyone.
            </p>
            <Link to="/recruiter/dashboard">
              <Button className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-8">
          <Link to="/recruiter/dashboard" className="text-gray-400 hover:text-white flex items-center gap-2 mb-4">
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
          <h1 className="text-4xl font-bold text-white mb-2">
            <MessageSquare className="inline-block w-8 h-8 mr-3 text-purple-400" />
            Post-Hire Feedback
          </h1>
          <p className="text-gray-400">Help us improve by sharing your experience with the hired candidate</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <Card className="bg-white/10 backdrop-blur-lg border-white/20">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center">
                  <User className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-sm text-gray-400">Candidate</p>
                  <p className="text-white font-medium">Alex Johnson</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/10 backdrop-blur-lg border-white/20">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm text-gray-400">Position</p>
                  <p className="text-white font-medium">Senior Frontend Developer</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/10 backdrop-blur-lg border-white/20">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <p className="text-sm text-gray-400">Hire Date</p>
                  <p className="text-white font-medium">March 15, 2026</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-white/10 backdrop-blur-lg border-white/20 mb-6">
          <CardHeader>
            <CardTitle className="text-white">Rate Your Experience</CardTitle>
          </CardHeader>
          <CardContent>
            <StarRating
              value={form.rating}
              onChange={(v) => handleStarClick('rating', v)}
              label="Overall Rating"
            />
            <StarRating
              value={form.hireQuality}
              onChange={(v) => handleStarClick('hireQuality', v)}
              label="Quality of Hire"
            />
            <StarRating
              value={form.communication}
              onChange={(v) => handleStarClick('communication', v)}
              label="Communication During Process"
            />
            <StarRating
              value={form.timeline}
              onChange={(v) => handleStarClick('timeline', v)}
              label="Hiring Timeline"
            />
            <StarRating
              value={form.overallExperience}
              onChange={(v) => handleStarClick('overallExperience', v)}
              label="Overall Platform Experience"
            />
          </CardContent>
        </Card>

        <Card className="bg-white/10 backdrop-blur-lg border-white/20 mb-6">
          <CardHeader>
            <CardTitle className="text-white">Detailed Feedback</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-gray-300">What went well?</Label>
              <Textarea
                value={form.strengths}
                onChange={(e) => setForm(prev => ({ ...prev, strengths: e.target.value }))}
                placeholder="Describe the strengths of the candidate and the hiring process..."
                className="bg-white/5 border-white/20 text-white placeholder:text-gray-500 mt-2"
                rows={4}
              />
            </div>
            <div>
              <Label className="text-gray-300">What could be improved?</Label>
              <Textarea
                value={form.improvements}
                onChange={(e) => setForm(prev => ({ ...prev, improvements: e.target.value }))}
                placeholder="Share any suggestions for improvement..."
                className="bg-white/5 border-white/20 text-white placeholder:text-gray-500 mt-2"
                rows={4}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/10 backdrop-blur-lg border-white/20 mb-6">
          <CardHeader>
            <CardTitle className="text-white">Quick Questions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-gray-300 mb-2 block">Would you recommend this candidate to others?</Label>
              <div className="flex gap-3">
                <button
                  onClick={() => setForm(prev => ({ ...prev, wouldRecommend: true }))}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition ${
                    form.wouldRecommend === true
                      ? 'bg-green-500/20 border-green-500 text-green-400'
                      : 'bg-white/5 border-white/20 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  <ThumbsUp className="w-4 h-4" />
                  Yes
                </button>
                <button
                  onClick={() => setForm(prev => ({ ...prev, wouldRecommend: false }))}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition ${
                    form.wouldRecommend === false
                      ? 'bg-red-500/20 border-red-500 text-red-400'
                      : 'bg-white/5 border-white/20 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  <ThumbsDown className="w-4 h-4" />
                  No
                </button>
              </div>
            </div>
            <div>
              <Label className="text-gray-300 mb-2 block">Would you hire through Rekrut AI again?</Label>
              <div className="flex gap-3">
                <button
                  onClick={() => setForm(prev => ({ ...prev, hireAgain: true }))}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition ${
                    form.hireAgain === true
                      ? 'bg-green-500/20 border-green-500 text-green-400'
                      : 'bg-white/5 border-white/20 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  <ThumbsUp className="w-4 h-4" />
                  Yes
                </button>
                <button
                  onClick={() => setForm(prev => ({ ...prev, hireAgain: false }))}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition ${
                    form.hireAgain === false
                      ? 'bg-red-500/20 border-red-500 text-red-400'
                      : 'bg-white/5 border-white/20 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  <ThumbsDown className="w-4 h-4" />
                  No
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <AlertCircle className="w-4 h-4" />
            Your feedback is anonymous and helps improve our AI matching
          </div>
          <Button
            onClick={handleSubmit}
            disabled={form.rating === 0}
            className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-50"
          >
            <Send className="w-4 h-4 mr-2" />
            Submit Feedback
          </Button>
        </div>
      </div>
    </div>
  );
}
