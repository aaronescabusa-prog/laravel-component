import { useEffect, useMemo, useState } from "react";

/**
 * Client-side pagination for the admin tables.
 * ---------------------------------------------------------------------------
 * The Laravel endpoints already paginate (15 rows by default), but every list
 * screen additionally filters, sorts, computes KPIs and exports CSV from the
 * *whole* result set, so the client always asks for every row (see
 * `api.list` -> `per_page: 1000`) and paginates the filtered rows here.
 *
 * const pager = usePagination(filteredRows, {
 *     pageSize: 10,
 *     // change any filter/search/sort value to jump back to page 1
 *     resetKey: [search, statusFilter, sortKey, sortDir].join("|"),
 * });
 * <tbody>{pager.pageRows.map(...)}</tbody>
 */
export function usePagination(rows, options = {}) {
    const { pageSize: initialPageSize = 10, resetKey = "" } = options;

    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(initialPageSize);

    // Any filter / search / sort change invalidates the current offset.
    useEffect(() => {
        setPage(1);
    }, [resetKey]);

    const total = Array.isArray(rows) ? rows.length : 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // Guard against deleting every row on the last page.
    useEffect(() => {
        setPage((current) => Math.min(current, totalPages));
    }, [totalPages]);

    // Clamp during render too, so the very first paint after a shrink is valid.
    const currentPage = Math.min(Math.max(1, page), totalPages);
    const start = (currentPage - 1) * pageSize;
    const end = Math.min(start + pageSize, total);

    const pageRows = useMemo(() => rows.slice(start, end), [rows, start, end]);

    function goToPage(next) {
        const target = Number(next);
        if (!Number.isFinite(target)) return;
        setPage(Math.min(Math.max(1, Math.trunc(target)), totalPages));
    }

    function changePageSize(next) {
        const size = Number(next);
        if (!Number.isFinite(size) || size < 1) return;
        setPageSize(size);
        setPage(1);
    }

    return {
        page: currentPage,
        pageSize,
        totalPages,
        pageRows,
        total,
        firstRow: total === 0 ? 0 : start + 1,
        lastRow: end,
        hasPrevious: currentPage > 1,
        hasNext: currentPage < totalPages,
        goToPage,
        changePageSize,
        previousPage: () => goToPage(currentPage - 1),
        nextPage: () => goToPage(currentPage + 1),
    };
}
