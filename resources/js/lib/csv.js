/** Local `YYYY-MM-DD` for default export filenames (matches the user's clock). */
export function dateStamp(date = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Build a BOM-prefixed CSV file and trigger a browser download. */
export function downloadCSV(filename, rows) {
    const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = rows.map((row) => row.map(escape).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
/**
 * Parse CSV text into a header row and aligned data rows.
 *
 * Handles the shapes a spreadsheet actually exports: a leading UTF-8 BOM (Excel
 * writes one, and it would otherwise end up glued to the first header), CRLF or
 * LF line endings, quoted fields, commas and newlines inside quotes, and a
 * doubled quote as an escaped one.
 *
 * Returns `{ headers, rows }`. Every row is padded or truncated to the header
 * length so callers can index by column position without bounds checks, and a
 * trailing entirely-blank line is dropped rather than read as an empty record.
 */
export function parseCSV(text) {
    const source = String(text ?? "").replace(/^\uFEFF/, "");

    const records = [];
    let record = [];
    let field = "";
    let quoted = false;

    for (let i = 0; i < source.length; i += 1) {
        const char = source[i];

        if (quoted) {
            if (char === '"' && source[i + 1] === '"') {
                field += '"';
                i += 1;
            } else if (char === '"') {
                quoted = false;
            } else {
                field += char;
            }
            continue;
        }

        if (char === '"' && field === "") {
            quoted = true;
        } else if (char === ",") {
            record.push(field);
            field = "";
        } else if (char === "\n" || (char === "\r" && source[i + 1] !== "\n")) {
            record.push(field);
            records.push(record);
            record = [];
            field = "";
        } else if (char !== "\r") {
            field += char;
        }
    }

    record.push(field);
    records.push(record);

    while (records.length > 0 && records[records.length - 1].every((cell) => cell === "")) {
        records.pop();
    }

    const headers = (records.shift() ?? []).map((header) => header.trim());

    return {
        headers,
        rows: records.map((cells) => headers.map((_, index) => (cells[index] ?? "").trim())),
    };
}