import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { MessageCircle, X, Send, ArrowLeft, Mail } from 'lucide-react';
import { useTenant } from '../contexts/TenantContext';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function getAuthToken() {
  try {
    const session = JSON.parse(sessionStorage.getItem('sangha_auth'));
    if (session?.tokens?.accessToken) return session.tokens.accessToken;
  } catch {}
  const legacy = localStorage.getItem('auth_token');
  if (legacy) return legacy;
  return null;
}

// Resolve the primary agent ID for this tenant's industry
function getHelpAgentId(tenant) {
  const industry = tenant?.settings?.industry;
  if (industry === 'construction') return 'hivemind';
  if (industry === 'venture') return 'zhan';
  return 'sangha';
}

export default function HelpChatWidget() {
  const { tenant } = useTenant();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('chat'); // 'chat' | 'support'
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [threadId, setThreadId] = useState(null);
  const [supportForm, setSupportForm] = useState({ name: '', email: '', message: '' });
  const [supportSending, setSupportSending] = useState(false);
  const [supportSent, setSupportSent] = useState(false);
  const messagesEndRef = useRef(null);
  const helpContainerRef = useRef(null);
  const helpScrolledUpRef = useRef(false);
  const inputRef = useRef(null);

  const accentColor = tenant?.branding?.primaryColor || '#1a6b3c';
  const agentId = getHelpAgentId(tenant);

  // Scroll to bottom on new messages — only if user hasn't scrolled up
  useEffect(() => {
    if (!helpScrolledUpRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleHelpScroll = () => {
    const el = helpContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    helpScrolledUpRef.current = !atBottom;
  };

  // Focus input when panel opens
  useEffect(() => {
    if (open && view === 'chat') {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [open, view]);

  // Load thread messages when reopening (if we have a threadId)
  useEffect(() => {
    if (!open || !threadId) return;
    const token = getAuthToken();
    fetch(`${API_BASE}/v1/chat/${agentId}/threads/${threadId}/messages`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then(data => {
        if (data.messages?.length > 0) {
          setMessages(data.messages.map(m => ({
            id: m.id,
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content,
          })));
        }
      })
      .catch(() => {});
  }, [open, threadId, agentId]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    helpScrolledUpRef.current = false;

    const userMsg = { id: Date.now(), role: 'user', content: text };
    const assistantMsgId = Date.now() + 1;
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);

    const token = getAuthToken();

    try {
      // Use public help endpoint when not authenticated, authenticated endpoint when logged in
      let postUrl;
      if (token && threadId) {
        postUrl = `${API_BASE}/v1/chat/${agentId}/threads/${threadId}/messages/stream`;
      } else if (token) {
        postUrl = `${API_BASE}/v1/chat/${agentId}/messages/stream`;
      } else {
        // Public help endpoint — no auth required
        postUrl = `${API_BASE}/v1/chat/help/${agentId}/messages/stream`;
      }

      const res = await fetch(postUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ content: text, helpMode: true }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Error (${res.status})`);
      }

      // Add empty assistant message that we'll stream into
      setMessages(prev => [...prev, { id: assistantMsgId, role: 'assistant', content: '' }]);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'text') {
              setMessages(prev => prev.map(m =>
                m.id === assistantMsgId ? { ...m, content: m.content + event.text } : m
              ));
            } else if (event.type === 'thread' && event.threadId && !threadId) {
              setThreadId(event.threadId);
            } else if (event.type === 'error') {
              throw new Error(event.error);
            }
          } catch (parseErr) {
            if (parseErr.message !== 'Unexpected end of JSON input') {
              console.warn('SSE parse error:', parseErr);
            }
          }
        }
      }
    } catch (err) {
      setMessages(prev => {
        // Remove empty streaming message if it exists
        const filtered = prev.filter(m => !(m.id === assistantMsgId && !m.content));
        return [...filtered, {
          id: Date.now() + 2,
          role: 'assistant',
          content: err?.message === 'Unauthorized'
            ? 'Session expired. Please refresh the page.'
            : 'Something went wrong. Please try again.',
          error: true,
        }];
      });
    } finally {
      setSending(false);
    }
  }, [input, sending, threadId, agentId]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSupportSubmit = async (e) => {
    e.preventDefault();
    if (!supportForm.message.trim()) return;
    setSupportSending(true);

    try {
      const res = await fetch(`${API_BASE}/v1/demo-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: supportForm.name || 'Help Widget User',
          email: supportForm.email || 'no-email@unknown.com',
          company: tenant?.name || 'Unknown',
          notes: `[Support Message]\n${supportForm.message}`,
        }),
      });

      if (res.ok) {
        setSupportSent(true);
        setSupportForm({ name: '', email: '', message: '' });
      }
    } catch {}
    setSupportSending(false);
  };

  return (
    <>
      {/* Chat Panel */}
      <div
        className={`fixed bottom-20 right-6 z-[9999] flex flex-col bg-white rounded-2xl overflow-hidden transition-all duration-300 ease-out ${
          open
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
        style={{
          width: 'min(380px, calc(100vw - 32px))',
          height: 'min(500px, calc(100vh - 140px))',
          boxShadow: '0 8px 40px rgba(0,0,0,0.12), 0 2px 12px rgba(0,0,0,0.06)',
        }}
      >
        {/* Header */}
        <div
          className="shrink-0 flex items-center justify-between px-5 py-3.5"
          style={{ backgroundColor: accentColor }}
        >
          <div className="flex items-center gap-2.5">
            {view === 'support' && (
              <button
                onClick={() => { setView('chat'); setSupportSent(false); }}
                className="text-white/70 hover:text-white transition-colors mr-1"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <div>
              <p className="text-[14px] font-semibold text-white">
                {view === 'support' ? 'Contact Support' : 'Coppice Assistant'}
              </p>
              {view === 'chat' && (
                <p className="text-[11px] text-white/60 flex items-center gap-1">
                  <span className="w-[5px] h-[5px] rounded-full bg-[#2dd478] inline-block" />
                  Online
                </p>
              )}
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="text-white/60 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {view === 'chat' ? (
          <>
            {/* Messages */}
            <div ref={helpContainerRef} onScroll={handleHelpScroll} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-[#fafaf8]">
              {messages.length === 0 && !sending && (
                <div className="text-center py-10">
                  <div
                    className="w-10 h-10 rounded-xl mx-auto mb-3 flex items-center justify-center"
                    style={{ backgroundColor: `${accentColor}15` }}
                  >
                    <MessageCircle size={20} style={{ color: accentColor }} />
                  </div>
                  <p className="text-[13px] font-medium text-terminal-text">How can I help?</p>
                  <p className="text-[11px] text-terminal-muted mt-1">
                    Ask me anything about the platform.
                  </p>
                </div>
              )}

              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] px-3.5 py-2.5 text-[13px] leading-[1.5] ${
                      msg.role === 'user'
                        ? 'rounded-2xl rounded-br-md text-white whitespace-pre-wrap'
                        : `rounded-2xl rounded-bl-md ${msg.error ? 'bg-red-50 text-terminal-red' : 'bg-white text-terminal-text border border-terminal-border'}`
                    }`}
                    style={msg.role === 'user' ? { backgroundColor: accentColor } : undefined}
                  >
                    {msg.role === 'user' ? msg.content : (
                      <ReactMarkdown
                        components={{
                          p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
                          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                          ul: ({ children }) => <ul className="list-disc pl-4 mb-1.5 space-y-0.5">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal pl-4 mb-1.5 space-y-0.5">{children}</ol>,
                          li: ({ children }) => <li>{children}</li>,
                          a: ({ href, children }) => <a href={href} className="underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    )}
                  </div>
                </div>
              ))}

              {/* Typing indicator */}
              {sending && (
                <div className="flex justify-start">
                  <div className="bg-white border border-terminal-border rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1">
                    <span className="w-[6px] h-[6px] rounded-full bg-terminal-muted animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-[6px] h-[6px] rounded-full bg-terminal-muted animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-[6px] h-[6px] rounded-full bg-terminal-muted animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className="shrink-0 border-t border-terminal-border bg-white px-3 py-2.5">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message..."
                  rows={1}
                  className="flex-1 resize-none rounded-xl bg-[#f5f4f0] border border-terminal-border px-3.5 py-2 text-[13px] text-terminal-text placeholder:text-terminal-muted focus:outline-none focus:border-[color:var(--t-accent)] transition-colors"
                  style={{ maxHeight: 80 }}
                  onInput={(e) => {
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, 80) + 'px';
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || sending}
                  className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-white transition-all disabled:opacity-40"
                  style={{ backgroundColor: accentColor }}
                >
                  <Send size={15} />
                </button>
              </div>

              {/* Contact support link */}
              <button
                onClick={() => setView('support')}
                className="w-full mt-2 flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-terminal-muted hover:text-terminal-text transition-colors"
              >
                <Mail size={12} />
                Send a message to admin
              </button>
            </div>
          </>
        ) : (
          /* Support form view */
          <div className="flex-1 overflow-y-auto px-5 py-4 bg-[#fafaf8]">
            {supportSent ? (
              <div className="text-center py-12">
                <div className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center bg-green-50">
                  <Mail size={22} className="text-green-600" />
                </div>
                <p className="text-[14px] font-semibold text-terminal-text">Message sent</p>
                <p className="text-[12px] text-terminal-muted mt-1">
                  We'll get back to you within 24 hours.
                </p>
                <button
                  onClick={() => { setView('chat'); setSupportSent(false); }}
                  className="mt-4 text-[12px] font-medium hover:underline"
                  style={{ color: accentColor }}
                >
                  Back to chat
                </button>
              </div>
            ) : (
              <form onSubmit={handleSupportSubmit} className="space-y-3">
                <p className="text-[12px] text-terminal-muted mb-1">
                  Send a message directly to our team.
                </p>
                <div>
                  <label className="block text-[11px] font-medium text-terminal-text mb-1">Name</label>
                  <input
                    type="text"
                    value={supportForm.name}
                    onChange={e => setSupportForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Your name"
                    className="w-full rounded-lg bg-white border border-terminal-border px-3 py-2 text-[13px] text-terminal-text placeholder:text-terminal-muted focus:outline-none focus:border-[color:var(--t-accent)] transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-terminal-text mb-1">Email</label>
                  <input
                    type="email"
                    value={supportForm.email}
                    onChange={e => setSupportForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="your@email.com"
                    className="w-full rounded-lg bg-white border border-terminal-border px-3 py-2 text-[13px] text-terminal-text placeholder:text-terminal-muted focus:outline-none focus:border-[color:var(--t-accent)] transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-terminal-text mb-1">Message *</label>
                  <textarea
                    value={supportForm.message}
                    onChange={e => setSupportForm(f => ({ ...f, message: e.target.value }))}
                    placeholder="Describe your issue or question..."
                    rows={4}
                    required
                    className="w-full rounded-lg bg-white border border-terminal-border px-3 py-2 text-[13px] text-terminal-text placeholder:text-terminal-muted focus:outline-none focus:border-[color:var(--t-accent)] transition-colors resize-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!supportForm.message.trim() || supportSending}
                  className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all disabled:opacity-50"
                  style={{ backgroundColor: accentColor }}
                >
                  {supportSending ? 'Sending...' : 'Send Message'}
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      {/* Floating bubble button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`fixed bottom-6 right-6 z-[9999] w-12 h-12 rounded-full flex items-center justify-center text-white transition-all duration-300 hover:scale-105 active:scale-95`}
        style={{
          backgroundColor: accentColor,
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        }}
        title={open ? 'Close help chat' : 'Open help chat'}
      >
        {open ? <X size={20} /> : <MessageCircle size={20} />}
      </button>
    </>
  );
}
