import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Loading, Empty } from './Primitives.jsx';

export function DataTable({ columns, rows, loading, onRowClick, emptyTitle, emptySub }) {
  if (loading && !rows) return <Loading />;
  if (rows && rows.length === 0) return <Empty title={emptyTitle || 'No records'} sub={emptySub} />;

  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-ink-200/70 bg-white">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={clsx('th', c.className)}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {(rows || []).map((row) => (
            <tr
              key={row.id || row._id}
              className={clsx('tr-hover', onRowClick && 'cursor-pointer')}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={clsx('td', c.className)}>
                  {c.render ? c.render(row) : getByPath(row, c.key)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ meta, onPage }) {
  if (!meta) return null;
  const { page, pages, total } = meta;
  return (
    <div className="flex items-center justify-between mt-3 text-sm text-ink-600">
      <div>
        Page <span className="font-medium text-ink-800">{page}</span> of{' '}
        <span className="font-medium text-ink-800">{pages}</span>
        <span className="mx-2 text-ink-400">•</span>
        <span className="tabular-nums">{total}</span> records
      </div>
      <div className="flex items-center gap-1">
        <button
          className="btn-secondary px-2 py-1.5"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          className="btn-secondary px-2 py-1.5"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function getByPath(obj, path) {
  return path.split('.').reduce((a, k) => (a ? a[k] : undefined), obj);
}
