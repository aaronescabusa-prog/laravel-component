import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Row selection shared by the admin table screens.
 * ---------------------------------------------------------------------------
 * Gives a table the Gmail-style pair of "select all" meanings that a single
 * checkbox cannot express on its own:
 *
 *   - the header checkbox selects/deselects the rows on the current page only
 *   - when the page is fully selected and more rows match the current filters,
 *     the bulk bar offers "select all N matching" to extend the selection to
 *     every row the filters match, not just the page
 *
 * Selection lives in ids rather than row objects so that re-rendering, sorting
 * or a refetch cannot leave a stale object selected, and so that a row that
 * changed underneath is still the same selection.
 *
 * The scope is *derived*, never stored: "did I select everything?" is answered
 * from the ids against the current matching set. Storing it would let the two
 * disagree after a filter change.
 *
 *   const selection = useRowSelection({
 *       pageRows: pager.pageRows,
 *       matchingRows: filteredRows,
 *       // change any filter/search/sort value to clear the selection
 *       resetKey: [search, statusFilter].join("|"),
 *   });
 *
 *   selection.isSelected(row.id)
 *   selection.toggleOne(row.id)
 *   selection.togglePage()
 *   selection.selectAllMatching()
 *   selection.clear()
 */
export function useRowSelection({ pageRows = [], matchingRows = [], idKey = "id", resetKey = "" } = {}) {
    const [selectedIds, setSelectedIds] = useState([]);

    // A filter change invalidates the selection. Leaving it in place would mean
    // "select all matching" silently covering a different set of rows than the
    // ones the operator was looking at when they ticked the box.
    useEffect(() => {
        setSelectedIds([]);
    }, [resetKey]);

    const matchingIds = useMemo(() => matchingRows.map((row) => row[idKey]), [matchingRows, idKey]);
    const pageIds = useMemo(() => pageRows.map((row) => row[idKey]), [pageRows, idKey]);

    const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

    const isSelected = useCallback((id) => selected.has(id), [selected]);

    const toggleOne = useCallback((id) => {
        setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    }, []);

    const clear = useCallback(() => setSelectedIds([]), []);

    /** Drop specific ids from the selection, leaving the rest ticked. */
    const deselect = useCallback((ids) => {
        const dropping = new Set(ids);
        setSelectedIds((prev) => prev.filter((id) => !dropping.has(id)));
    }, []);

    // Only the current page is affected either way; rows selected elsewhere
    // (another page, or an earlier "select all matching") are left alone.
    const togglePage = useCallback(() => {
        setSelectedIds((prev) => {
            const pageSelected = pageIds.length > 0 && pageIds.every((id) => prev.includes(id));

            if (pageSelected) {
                const dropping = new Set(pageIds);
                return prev.filter((id) => !dropping.has(id));
            }

            return Array.from(new Set([...prev, ...pageIds]));
        });
    }, [pageIds]);

    const selectAllMatching = useCallback(() => setSelectedIds(matchingIds), [matchingIds]);

    const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
    const pageSomeSelected = !pageAllSelected && pageIds.some((id) => selected.has(id));

    const allMatchingSelected = matchingIds.length > 0 && matchingIds.every((id) => selected.has(id));

    // "Only the page is selected, and there is more to take" — the one case
    // where extending the selection is worth offering.
    const pageOnlySelection =
        pageAllSelected &&
        selectedIds.length === pageIds.length &&
        matchingIds.length > pageIds.length;

    // Rows the operator chose by hand that are no longer on screen, so a bulk
    // action can describe what it is about to touch.
    const selectedRows = useMemo(
        () => matchingRows.filter((row) => selected.has(row[idKey])),
        [matchingRows, selected, idKey]
    );

    return {
        selectedIds,
        selectedRows,
        selectedCount: selectedIds.length,
        isSelected,
        toggleOne,
        togglePage,
        selectAllMatching,
        clear,
        deselect,
        pageAllSelected,
        pageSomeSelected,
        allMatchingSelected,
        pageOnlySelection,
        matchingCount: matchingIds.length,
        pageCount: pageIds.length,
    };
}

export default useRowSelection;