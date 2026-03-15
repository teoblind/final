import { AlertCircle, Database, Zap, BarChart3, Users, Mail, Shield, Settings, Activity } from 'lucide-react';

const ICONS = {
  alert: AlertCircle,
  database: Database,
  zap: Zap,
  chart: BarChart3,
  users: Users,
  mail: Mail,
  shield: Shield,
  settings: Settings,
  activity: Activity,
};

/**
 * Reusable empty state component for pages/panels with no data.
 *
 * Props:
 *   icon     — icon name string (from ICONS map) or a Lucide icon component
 *   title    — main heading
 *   subtitle — secondary text
 *   ctaLabel — optional button label
 *   onCta    — optional button click handler
 *   compact  — if true, uses less vertical padding (for inline panels)
 */
export default function EmptyState({ icon, title, subtitle, ctaLabel, onCta, compact }) {
  const IconComponent = typeof icon === 'string' ? ICONS[icon] || AlertCircle : icon || AlertCircle;

  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-8 px-4' : 'py-16 px-6'}`}>
      <div className="mb-4 opacity-30">
        <IconComponent size={compact ? 32 : 48} strokeWidth={1.2} />
      </div>
      <h3 className="text-sm font-medium" style={{ color: '#888' }}>{title}</h3>
      {subtitle && (
        <p className="text-xs mt-1.5 max-w-xs leading-relaxed" style={{ color: '#3a3a3a' }}>
          {subtitle}
        </p>
      )}
      {ctaLabel && onCta && (
        <button
          onClick={onCta}
          className="mt-4 px-4 py-1.5 text-xs font-medium rounded-md transition-colors"
          style={{
            background: 'var(--t-accent, #1a2e1a)',
            color: '#fff',
          }}
        >
          {ctaLabel}
        </button>
      )}
    </div>
  );
}
