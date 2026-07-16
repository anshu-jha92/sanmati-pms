import { useState } from 'react';
import { Search, X, Filter as FilterIcon } from 'lucide-react';

/**
 * Generic filter bar. Fields are declarative so each page can enable only what it needs.
 *
 * <FilterBar
 *   value={filters}
 *   onChange={setFilters}
 *   fields={['search','status','stage','date','team','machine']}
 *   options={{ status: [...], stage: [...], teams: [...], machines: [...] }}
 * />
 */
export function FilterBar({ value, onChange, fields = [], options = {} }) {
  const [local, setLocal] = useState(value);
  const update = (k, v) => {
    const next = { ...local, [k]: v === '' ? undefined : v };
    setLocal(next);
    onChange(next);
  };
  const clear = () => {
    setLocal({});
    onChange({});
  };

  return (
    <div className="flex flex-wrap items-end gap-2 bg-white rounded-xl p-3 ring-1 ring-ink-200/70">
      {fields.includes('search') && (
        <div className="flex-1 min-w-[220px]">
          <label className="label">Search</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
            <input
              className="input pl-8"
              placeholder="Search..."
              value={local.q || ''}
              onChange={(e) => update('q', e.target.value)}
            />
          </div>
        </div>
      )}
      {fields.includes('status') && (
        <Select label="Status" value={local.status} onChange={(v) => update('status', v)} options={options.status || []} />
      )}
      {fields.includes('stage') && (
        <Select
          label="Stage"
          value={local.stage}
          onChange={(v) => update('stage', v)}
          options={[
            'printing',
            'inspection',
            'lamination',
            'slitting',
            'cutting',
            'packaging',
          ].map((s) => ({ value: s, label: s }))}
        />
      )}
      {fields.includes('team') && (
        <Select
          label="Team"
          value={local.teamId}
          onChange={(v) => update('teamId', v)}
          options={(options.teams || []).map((t) => ({ value: t._id, label: t.name }))}
        />
      )}
      {fields.includes('machine') && (
        <Select
          label="Machine"
          value={local.machineId}
          onChange={(v) => update('machineId', v)}
          options={(options.machines || []).map((m) => ({ value: m._id, label: `${m.code} — ${m.name}` }))}
        />
      )}
      {fields.includes('operator') && (
        <Select
          label="Operator"
          value={local.operatorId}
          onChange={(v) => update('operatorId', v)}
          options={(options.operators || []).map((u) => ({ value: u._id, label: `${u.employeeCode} ${u.name}` }))}
        />
      )}
      {fields.includes('date') && (
        <>
          <div>
            <label className="label">From</label>
            <input
              type="date"
              className="input w-40"
              value={local.dateFrom || ''}
              onChange={(e) => update('dateFrom', e.target.value)}
            />
          </div>
          <div>
            <label className="label">To</label>
            <input
              type="date"
              className="input w-40"
              value={local.dateTo || ''}
              onChange={(e) => update('dateTo', e.target.value)}
            />
          </div>
        </>
      )}
      {fields.includes('month') && (
        <div>
          <label className="label">Month</label>
          <input
            type="month"
            className="input w-40"
            value={local.month || ''}
            onChange={(e) => update('month', e.target.value)}
          />
        </div>
      )}
      {fields.includes('year') && (
        <div>
          <label className="label">Year</label>
          <input
            type="number"
            min="2000"
            max="2100"
            className="input w-28"
            value={local.year || ''}
            onChange={(e) => update('year', e.target.value)}
          />
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-ink-500 flex items-center gap-1">
          <FilterIcon className="h-3.5 w-3.5" /> {Object.values(local).filter(Boolean).length} active
        </span>
        <button className="btn-ghost" onClick={clear}>
          <X className="h-4 w-4" /> Clear
        </button>
      </div>
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <div>
      <label className="label">{label}</label>
      <select className="input w-44" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
