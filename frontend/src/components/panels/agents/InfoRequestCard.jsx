import { useState } from 'react';
import { AlertCircle, Send, Paperclip } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

function getAuthHeaders() {
  const token = sessionStorage.getItem('sangha_token') || sessionStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function InfoRequestCard({ jobId, request, onResolved }) {
  const [response, setResponse] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!response.trim()) return;
    setSubmitting(true);
    try {
      await fetch(`${API_BASE}/v1/jobs/${jobId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ respondToId: request.id, content: response }),
      });
      setResponse('');
      onResolved?.();
    } catch (err) {
      console.error('Failed to submit info:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-[18px] mb-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
      <div className="flex items-start gap-2 mb-2">
        <AlertCircle size={14} className="text-amber-600 mt-0.5 shrink-0" />
        <div>
          <div className="text-[11px] font-semibold text-amber-800">Information Needed</div>
          <div className="text-[11px] text-amber-700 mt-0.5 leading-relaxed whitespace-pre-wrap">
            {request.content}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <textarea
          value={response}
          onChange={e => setResponse(e.target.value)}
          placeholder="Paste the requested information here..."
          className="flex-1 text-[11px] px-3 py-2 border border-amber-200 rounded-md bg-white focus:outline-none focus:border-amber-400 placeholder:text-amber-300 min-h-[60px] resize-y"
          disabled={submitting}
        />
        <button
          onClick={handleSubmit}
          disabled={submitting || !response.trim()}
          className="self-end px-3 py-2 text-[11px] font-heading font-semibold bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50 flex items-center gap-1"
        >
          <Send size={11} /> {submitting ? 'Sending...' : 'Submit'}
        </button>
      </div>
    </div>
  );
}
