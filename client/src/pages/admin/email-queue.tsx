import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiCall } from '@/lib/api';
import { Mail, RefreshCw, AlertCircle, CheckCircle, Clock } from 'lucide-react';

export function AdminEmailQueuePage() {
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);

  async function loadStats() {
    setLoading(true);
    try {
      const res = await apiCall<{ stats: Record<string, number> }>('/admin/email-queue');
      if (res.success) setStats(res.stats);
    } catch (err) {
      console.error('Failed to load email queue stats:', err);
    } finally {
      setLoading(false);
    }
  }

  async function retryFailed() {
    setRetrying(true);
    try {
      const res = await apiCall<{ retried: number }>('/admin/email-queue/retry', { method: 'POST' });
      if (res.success) {
        alert(`Retried ${res.retried} failed emails`);
        await loadStats();
      }
    } catch (err) {
      console.error('Failed to retry emails:', err);
    } finally {
      setRetrying(false);
    }
  }

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const statusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    pending: { label: 'Pending', color: 'bg-amber-500', icon: <Clock className="h-4 w-4" /> },
    sent: { label: 'Sent', color: 'bg-green-500', icon: <CheckCircle className="h-4 w-4" /> },
    failed: { label: 'Failed', color: 'bg-red-500', icon: <AlertCircle className="h-4 w-4" /> },
  };

  const total = Object.values(stats).reduce((sum, n) => sum + n, 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Mail className="h-6 w-6" />
          Email Queue
        </h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadStats} disabled={loading} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={retryFailed} disabled={retrying || (stats.failed || 0) === 0} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
            Retry Failed ({stats.failed || 0})
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {Object.entries(statusConfig).map(([status, config]) => (
          <Card key={status}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {config.icon}
                  <span className="font-medium">{config.label}</span>
                </div>
                <Badge className={`${config.color} text-white`}>{stats[status] || 0}</Badge>
              </div>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                <span className="font-medium">Total</span>
              </div>
              <Badge variant="outline">{total}</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Email Queue Status</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The email queue processes emails asynchronously every 30 seconds.
            Failed emails are retried up to 3 times automatically.
          </p>
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Processor Status</span>
              <Badge variant="outline" className="text-green-600">Running (30s interval)</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Max Retries</span>
              <Badge variant="outline">3</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Batch Size</span>
              <Badge variant="outline">10 per cycle</Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
