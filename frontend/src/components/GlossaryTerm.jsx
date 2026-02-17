import React, { useState, useRef, useEffect, useCallback } from 'react';
import INSURANCE_GLOSSARY from '../config/insuranceGlossary';

/**
 * GlossaryTerm — inline tooltip for insurance/financial terms.
 *
 * Usage:
 *   <GlossaryTerm id="quarq_spread">Quarq Spread</GlossaryTerm>
 *
 * Renders the text with a subtle dotted underline.
 * On hover (200ms delay), shows a tooltip with the term definition,
 * energy equivalent, and optional "Learn more" link.
 */
export default function GlossaryTerm({ id, children, onNavigate }) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, above: true });
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);
  const showTimer = useRef(null);

  const entry = INSURANCE_GLOSSARY[id];
  if (!entry) return <span>{children}</span>;

  const show = useCallback(() => {
    showTimer.current = setTimeout(() => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const above = rect.top > 180;
      setPosition({
        top: above ? rect.top - 8 : rect.bottom + 8,
        left: Math.max(16, Math.min(rect.left + rect.width / 2, window.innerWidth - 160)),
        above,
      });
      setVisible(true);
    }, 200);
  }, []);

  const hide = useCallback(() => {
    if (showTimer.current) clearTimeout(showTimer.current);
    setVisible(false);
  }, []);

  // Dismiss on scroll
  useEffect(() => {
    if (!visible) return;
    const handleScroll = () => hide();
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [visible, hide]);

  // Dismiss on click outside
  useEffect(() => {
    if (!visible) return;
    const handleClick = (e) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target) &&
          triggerRef.current && !triggerRef.current.contains(e.target)) {
        hide();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [visible, hide]);

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        className="border-b border-dotted border-terminal-muted/50 cursor-help"
      >
        {children}
      </span>
      {visible && (
        <div
          ref={tooltipRef}
          className="fixed z-[100] w-72 bg-terminal-panel border border-terminal-border rounded-lg shadow-xl p-3 pointer-events-auto"
          style={{
            top: position.above ? undefined : position.top,
            bottom: position.above ? `calc(100vh - ${position.top}px)` : undefined,
            left: position.left,
            transform: 'translateX(-50%)',
          }}
          onMouseEnter={() => { if (showTimer.current) clearTimeout(showTimer.current); }}
          onMouseLeave={hide}
        >
          <p className="text-xs font-bold text-terminal-text mb-1">{entry.term}</p>
          <p className="text-[11px] text-terminal-muted leading-relaxed mb-1.5">{entry.shortDef}</p>
          <p className="text-[10px] text-terminal-cyan">
            Energy equivalent: <span className="text-terminal-text">{entry.energyEquivalent}</span>
          </p>
          {entry.learnMorePanelId && onNavigate && (
            <button
              onClick={() => { onNavigate(entry.learnMorePanelId); hide(); }}
              className="mt-2 text-[10px] text-terminal-green hover:underline"
            >
              Learn more →
            </button>
          )}
        </div>
      )}
    </>
  );
}
