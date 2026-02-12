import React from 'react';
import { ArrowRight, Lock } from 'lucide-react';

interface PlaceholderPanelProps {
  title: string;
  icon: string;
  phase: number;
  description: string;
  features?: string[];
  configAction?: string;
  onConfigure?: () => void;
}

/**
 * Placeholder panel for features coming in future phases.
 * Provides visual consistency with active panels while clearly
 * indicating the panel is not yet functional.
 */
export default function PlaceholderPanel({
  title,
  icon,
  phase,
  description,
  features,
  configAction,
  onConfigure,
}: PlaceholderPanelProps) {
  return (
    <div className="bg-terminal-panel border border-dashed border-terminal-border/60 rounded-lg overflow-hidden opacity-80 hover:opacity-100 transition-opacity">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-terminal-border/40 bg-terminal-bg/30">
        <div className="flex items-center gap-3">
          <span className="text-xl">{icon}</span>
          <h3 className="font-semibold text-terminal-text">{title}</h3>
        </div>
        <span className="px-2 py-0.5 text-xs bg-terminal-border rounded text-terminal-muted">
          Phase {phase}
        </span>
      </div>

      {/* Content */}
      <div className="p-6">
        <p className="text-sm text-terminal-muted leading-relaxed mb-4">
          {description}
        </p>

        {features && features.length > 0 && (
          <ul className="space-y-2 mb-6">
            {features.map((feature, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-terminal-muted">
                <span className="text-terminal-green mt-0.5">+</span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        )}

        {/* CTA */}
        <div className="flex items-center gap-3">
          {configAction && onConfigure ? (
            <button
              onClick={onConfigure}
              className="flex items-center gap-2 px-4 py-2 text-sm border border-terminal-green/30 text-terminal-green rounded hover:bg-terminal-green/10 transition-colors"
            >
              {configAction}
              <ArrowRight size={14} />
            </button>
          ) : (
            <div className="flex items-center gap-2 text-xs text-terminal-muted">
              <Lock size={12} />
              <span>Coming in Phase {phase}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
