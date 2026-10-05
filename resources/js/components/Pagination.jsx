/**
 * Pagination bar shared by every admin list screen.
 * ---------------------------------------------------------------------------
 * Replaces the old placeholder markup ("Showing X of Y" with two permanently
 * disabled buttons) with a working pager: per-page selector, Previous/Next,
 * and a windowed page-number list with ellipses.
 *
 * Styling: the surrounding wrappers and the Previous/Next buttons reuse the
 * calling screen's own class prefix ("" for Users/Evaluations, "log-",
 * "events-", "regs-", "cert-", "ann-", "eval-" elsewhere) so each page keeps
 * its existing look. The page-number buttons use the shared `.pagination-page`
 * class defined in ui.css.
 *
 * usePagination() supplies all of the numbers; this component only renders them.
 */
function buildPageItems(current, totalPages) {
    if (totalPages <= 7) {
        return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const items = [1];
    const start = Math.max(2, current - 1);
    const end = Math.min(totalPages - 1, current + 1);

    if (start > 2) items.push("start-gap");
    for (let page = start; page <= end; page += 1) items.push(page);
    if (end < totalPages - 1) items.push("end-gap");
    items.push(totalPages);

    return items;
}

function Pagination({
    page,
    totalPages,
    pageSize,
    total,
    firstRow,
    lastRow,
    hasPrevious,
    hasNext,
    goToPage,
    changePageSize,
    previousPage,
    nextPage,
    classPrefix = "",
    unit = "records",
    loading = false,
    pageSizeOptions = [10, 25, 50, 100],
}) {
    const rootClass = classPrefix ? `${classPrefix}-pagination` : "pagination";
    const controlsClass = classPrefix ? `${classPrefix}-pagination-controls` : "pagination-controls";
    const buttonClass = classPrefix ? `${classPrefix}-btn ${classPrefix}-btn-secondary` : "btn btn-secondary";

    // Pad short option lists so the current page size is always selectable.
    const sizes = [...new Set([...pageSizeOptions, pageSize])].sort((a, b) => a - b);

    return (
        <div className={rootClass}>
            <span className="pagination-summary">
                {loading
                    ? `Loading ${unit}…`
                    : total === 0
                        ? `No ${unit} to show`
                        : `Showing ${firstRow}–${lastRow} of ${total} ${unit}`}
            </span>

            <div className={controlsClass}>
                <label className="pagination-size">
                    <span className="pagination-size-label">Rows</span>
                    <select
                        className="pagination-size-select"
                        value={pageSize}
                        onChange={(event) => changePageSize(Number(event.target.value))}
                        aria-label={`${unit} per page`}
                        disabled={loading}
                    >
                        {sizes.map((size) => (
                            <option key={size} value={size}>{size}</option>
                        ))}
                    </select>
                </label>

                <button
                    type="button"
                    className={buttonClass}
                    onClick={previousPage}
                    disabled={loading || !hasPrevious}
                >
                    Previous
                </button>

                <nav className="pagination-pages" aria-label="Pagination">
                    {buildPageItems(page, totalPages).map((item) => {
                        if (typeof item === "string") {
                            return (
                                <span key={item} className="pagination-page pagination-page-gap" aria-hidden="true">
                                    …
                                </span>
                            );
                        }

                        const isCurrent = item === page;
                        return (
                            <button
                                key={item}
                                type="button"
                                className={`pagination-page${isCurrent ? " active" : ""}`}
                                onClick={() => goToPage(item)}
                                disabled={loading}
                                aria-current={isCurrent ? "page" : undefined}
                                aria-label={`Page ${item}`}
                            >
                                {item}
                            </button>
                        );
                    })}
                </nav>

                <button
                    type="button"
                    className={buttonClass}
                    onClick={nextPage}
                    disabled={loading || !hasNext}
                >
                    Next
                </button>
            </div>
        </div>
    );
}

export default Pagination;