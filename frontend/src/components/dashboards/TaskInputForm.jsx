import React, { useState } from 'react';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';

/**
 * TaskInputForm - renders form fields based on input_fields_json definitions
 * and allows users to fill in required values before confirming a task.
 *
 * Props:
 *   inputFields: Array<{name, label, type, required, placeholder, description, options}>
 *   inputValues: Object - existing values keyed by field name
 *   onSubmit: (values: Object) => void
 *   disabled: boolean
 */
export default function TaskInputForm({ inputFields = [], inputValues = {}, onSubmit, disabled = false }) {
  const [values, setValues] = useState(() => {
    const initial = {};
    for (const field of inputFields) {
      initial[field.name] = inputValues[field.name] || '';
    }
    return initial;
  });
  const [showPasswords, setShowPasswords] = useState({});
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (name, value) => {
    setValues(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => { const n = { ...prev }; delete n[name]; return n; });
  };

  const togglePassword = (name) => {
    setShowPasswords(prev => ({ ...prev, [name]: !prev[name] }));
  };

  const validate = () => {
    const newErrors = {};
    for (const field of inputFields) {
      if (field.required && (!values[field.name] || String(values[field.name]).trim() === '')) {
        newErrors[field.name] = `${field.label || field.name} is required`;
      }
      if (field.type === 'email' && values[field.name]) {
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRe.test(values[field.name])) {
          newErrors[field.name] = 'Enter a valid email address';
        }
      }
      if (field.type === 'url' && values[field.name]) {
        try { new URL(values[field.name]); } catch {
          newErrors[field.name] = 'Enter a valid URL';
        }
      }
    }
    return newErrors;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const newErrors = validate();
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setSubmitted(true);
    onSubmit(values);
  };

  const allRequiredFilled = inputFields
    .filter(f => f.required)
    .every(f => values[f.name] && String(values[f.name]).trim() !== '');

  if (!inputFields.length) return null;

  return (
    <form onSubmit={handleSubmit} className="mt-2 mb-1">
      <div className="text-[10px] font-heading font-bold uppercase tracking-[0.5px] text-terminal-muted mb-2 flex items-center gap-1">
        <AlertCircle size={10} /> Required Information
      </div>
      <div className="space-y-2.5">
        {inputFields.map((field) => (
          <div key={field.name}>
            <label className="block text-[11px] font-medium text-terminal-text mb-0.5">
              {field.label || field.name}
              {field.required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            {field.description && (
              <div className="text-[10px] text-terminal-muted mb-1 leading-[1.4]">{field.description}</div>
            )}

            {/* Text input */}
            {(field.type === 'text' || field.type === 'email' || field.type === 'url') && (
              <input
                type={field.type}
                value={values[field.name] || ''}
                onChange={(e) => handleChange(field.name, e.target.value)}
                placeholder={field.placeholder || ''}
                disabled={disabled || submitted}
                className={`w-full px-2.5 py-1.5 text-[11px] rounded-md border transition-colors bg-white text-terminal-text placeholder:text-terminal-muted/50 focus:outline-none focus:ring-1 focus:ring-[var(--t-ui-accent)] ${
                  errors[field.name] ? 'border-red-300' : 'border-[#e5e5e0]'
                }`}
              />
            )}

            {/* Password input */}
            {field.type === 'password' && (
              <div className="relative">
                <input
                  type={showPasswords[field.name] ? 'text' : 'password'}
                  value={values[field.name] || ''}
                  onChange={(e) => handleChange(field.name, e.target.value)}
                  placeholder={field.placeholder || ''}
                  disabled={disabled || submitted}
                  className={`w-full px-2.5 py-1.5 pr-8 text-[11px] rounded-md border transition-colors bg-white text-terminal-text placeholder:text-terminal-muted/50 focus:outline-none focus:ring-1 focus:ring-[var(--t-ui-accent)] ${
                    errors[field.name] ? 'border-red-300' : 'border-[#e5e5e0]'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => togglePassword(field.name)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-terminal-muted hover:text-terminal-text"
                >
                  {showPasswords[field.name] ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
            )}

            {/* Textarea */}
            {field.type === 'textarea' && (
              <textarea
                value={values[field.name] || ''}
                onChange={(e) => handleChange(field.name, e.target.value)}
                placeholder={field.placeholder || ''}
                disabled={disabled || submitted}
                rows={3}
                className={`w-full px-2.5 py-1.5 text-[11px] rounded-md border transition-colors bg-white text-terminal-text placeholder:text-terminal-muted/50 resize-y focus:outline-none focus:ring-1 focus:ring-[var(--t-ui-accent)] ${
                  errors[field.name] ? 'border-red-300' : 'border-[#e5e5e0]'
                }`}
              />
            )}

            {/* Select */}
            {field.type === 'select' && (
              <select
                value={values[field.name] || ''}
                onChange={(e) => handleChange(field.name, e.target.value)}
                disabled={disabled || submitted}
                className={`w-full px-2.5 py-1.5 text-[11px] rounded-md border transition-colors bg-white text-terminal-text focus:outline-none focus:ring-1 focus:ring-[var(--t-ui-accent)] ${
                  errors[field.name] ? 'border-red-300' : 'border-[#e5e5e0]'
                }`}
              >
                <option value="">{field.placeholder || 'Select...'}</option>
                {(field.options || []).map((opt) => (
                  <option key={typeof opt === 'string' ? opt : opt.value} value={typeof opt === 'string' ? opt : opt.value}>
                    {typeof opt === 'string' ? opt : opt.label}
                  </option>
                ))}
              </select>
            )}

            {/* File placeholder (V1: no upload, just text note) */}
            {field.type === 'file' && (
              <input
                type="text"
                value={values[field.name] || ''}
                onChange={(e) => handleChange(field.name, e.target.value)}
                placeholder={field.placeholder || 'Paste a link to the file...'}
                disabled={disabled || submitted}
                className={`w-full px-2.5 py-1.5 text-[11px] rounded-md border transition-colors bg-white text-terminal-text placeholder:text-terminal-muted/50 focus:outline-none focus:ring-1 focus:ring-[var(--t-ui-accent)] ${
                  errors[field.name] ? 'border-red-300' : 'border-[#e5e5e0]'
                }`}
              />
            )}

            {errors[field.name] && (
              <div className="text-[10px] text-red-500 mt-0.5">{errors[field.name]}</div>
            )}
          </div>
        ))}
      </div>

      {!submitted && (
        <button
          type="submit"
          disabled={disabled || !allRequiredFilled}
          className="mt-2.5 px-3 py-1.5 text-[10px] font-heading font-semibold rounded-md bg-[var(--t-ui-accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          Save Inputs
        </button>
      )}
      {submitted && (
        <div className="mt-2 text-[10px] text-emerald-600 font-medium flex items-center gap-1">
          Inputs saved
        </div>
      )}
    </form>
  );
}
