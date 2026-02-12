import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import Panel, { Stat, PeriodSelector } from '../../Panel';
import { useApi, postApi } from '../../../hooks/useApi';
import { formatNumber, formatDate, formatCurrency, exportToCSV } from '../../../utils/formatters';

export default function FiberPanel() {
  const [period, setPeriod] = useState('1y');
  const [showDealModal, setShowDealModal] = useState(false);

  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/yahoo/fiber-basket',
    {
      params: { period },
      refreshInterval: 5 * 60 * 1000
    }
  );

  const { data: dcData } = useApi('/datacenter', { refreshInterval: 60 * 60 * 1000 });

  const basketData = data?.basket || [];
  const glwQqqRatio = data?.glwQqqRatio || [];
  const fiberDeals = dcData?.fiberDeals || [];

  const handleExport = () => {
    if (data?.basket) {
      exportToCSV(data.basket, 'fiber_basket');
    }
  };

  // Get current values
  const currentRatio = glwQqqRatio[glwQqqRatio.length - 1]?.ratio;
  const currentBasket = basketData[basketData.length - 1]?.basket;
  const currentQQQ = basketData[basketData.length - 1]?.qqq;

  const COLORS = {
    GLW: '#00d26a',
    COHR: '#007aff',
    CIEN: '#af52de',
    LITE: '#ffb800',
    COMM: '#00d4ff',
    QQQ: '#666'
  };

  return (
    <Panel
      title="Optical Fiber & AI Infrastructure"
      source={data?.source || 'Yahoo Finance'}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      onExport={handleExport}
      headerRight={
        <PeriodSelector
          value={period}
          onChange={setPeriod}
          options={['1M', '3M', '1Y']}
        />
      }
    >
      {/* GLW/QQQ Ratio */}
      <div className="bg-terminal-bg/50 rounded-lg p-3 mb-4">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-xs text-terminal-muted">GLW/QQQ Ratio (Fiber vs Tech)</p>
            <p className={`text-2xl font-bold ${currentRatio > 1 ? 'text-terminal-green' : 'text-terminal-red'}`}>
              {formatNumber(currentRatio, 3)}
            </p>
          </div>
          <div className="text-right text-sm">
            <p>Basket: {formatNumber(currentBasket, 1)}</p>
            <p className="text-terminal-muted">QQQ: {formatNumber(currentQQQ, 1)}</p>
          </div>
        </div>
      </div>

      {/* GLW/QQQ Ratio Chart */}
      <div className="h-32 mb-4">
        <p className="text-xs text-terminal-muted mb-2">GLW/QQQ Relative Performance</p>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={glwQqqRatio.slice(-180)}>
            <XAxis
              dataKey="date"
              tickFormatter={(d) => formatDate(d, 'MM/dd')}
              stroke="#666"
              fontSize={10}
              tickLine={false}
            />
            <YAxis
              domain={['auto', 'auto']}
              stroke="#666"
              fontSize={10}
              tickFormatter={(v) => v.toFixed(2)}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#111',
                border: '1px solid #333',
                borderRadius: '4px'
              }}
              formatter={(value) => [formatNumber(value, 3), 'GLW/QQQ']}
              labelFormatter={(label) => formatDate(label)}
            />
            <Line
              type="monotone"
              dataKey="ratio"
              stroke="#00d26a"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Basket Performance */}
      <div className="h-32 mb-4">
        <p className="text-xs text-terminal-muted mb-2">Fiber Basket vs QQQ (Indexed to 100)</p>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={basketData.slice(-180)}>
            <XAxis
              dataKey="date"
              tickFormatter={(d) => formatDate(d, 'MM/dd')}
              stroke="#666"
              fontSize={10}
              tickLine={false}
            />
            <YAxis
              domain={['auto', 'auto']}
              stroke="#666"
              fontSize={10}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#111',
                border: '1px solid #333',
                borderRadius: '4px'
              }}
              labelFormatter={(label) => formatDate(label)}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="basket"
              name="Fiber Basket"
              stroke="#00d26a"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="qqq"
              name="QQQ"
              stroke="#666"
              strokeWidth={1}
              strokeDasharray="3 3"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Deal Tracker */}
      <div className="border-t border-terminal-border pt-3">
        <div className="flex justify-between items-center mb-2">
          <p className="text-xs text-terminal-muted uppercase">Major Fiber/Infrastructure Deals</p>
          <button
            onClick={() => setShowDealModal(true)}
            className="text-xs text-terminal-green hover:underline"
          >
            + Add Deal
          </button>
        </div>
        <div className="space-y-2 max-h-32 overflow-y-auto">
          {fiberDeals.length === 0 ? (
            <p className="text-xs text-terminal-muted italic">
              No deals tracked yet. Add the Meta-Corning $6B deal (Jan 2026) to start.
            </p>
          ) : (
            fiberDeals.map((deal, i) => (
              <div key={i} className="flex justify-between text-sm bg-terminal-bg/50 rounded p-2">
                <div>
                  <p className="font-medium">{deal.buyer} ← {deal.seller}</p>
                  <p className="text-xs text-terminal-muted">{formatDate(deal.date)}</p>
                </div>
                <div className="text-right">
                  {deal.valueUSD && (
                    <p className="text-terminal-green">{formatCurrency(deal.valueUSD, 'USD', 0)}</p>
                  )}
                  {deal.capacity && (
                    <p className="text-xs text-terminal-muted">{deal.capacity}</p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Thesis context */}
      <p className="text-xs text-terminal-muted mt-3">
        Fiber is to AI inference what pipelines are to oil. Once GPUs and power are secured,
        the bottleneck shifts to physical interconnect layer.
      </p>

      {/* Deal Modal */}
      {showDealModal && (
        <DealModal onClose={() => setShowDealModal(false)} onSuccess={refetch} />
      )}
    </Panel>
  );
}

function DealModal({ onClose, onSuccess }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    buyer: '',
    seller: '',
    value_usd: '',
    capacity: '',
    description: ''
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await postApi('/datacenter/fiber-deal', form);
      onSuccess();
      onClose();
    } catch (err) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-terminal-panel border border-terminal-border rounded-lg p-6 w-full max-w-md">
        <h3 className="text-lg font-bold mb-4">Add Fiber/Infrastructure Deal</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-terminal-muted mb-1">Buyer</label>
              <input
                type="text"
                value={form.buyer}
                onChange={(e) => setForm({ ...form, buyer: e.target.value })}
                className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
                placeholder="e.g., Meta"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-terminal-muted mb-1">Seller</label>
              <input
                type="text"
                value={form.seller}
                onChange={(e) => setForm({ ...form, seller: e.target.value })}
                className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
                placeholder="e.g., Corning"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-terminal-muted mb-1">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-terminal-muted mb-1">Value (USD)</label>
              <input
                type="number"
                value={form.value_usd}
                onChange={(e) => setForm({ ...form, value_usd: e.target.value })}
                className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
                placeholder="6000000000"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-terminal-muted mb-1">Capacity/Details</label>
            <input
              type="text"
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: e.target.value })}
              className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
              placeholder="e.g., Multi-year fiber supply"
            />
          </div>
          <div>
            <label className="block text-xs text-terminal-muted mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
              rows={2}
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-terminal-border rounded hover:bg-terminal-border"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-terminal-green/20 border border-terminal-green/30 text-terminal-green rounded hover:bg-terminal-green/30 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Add Deal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
