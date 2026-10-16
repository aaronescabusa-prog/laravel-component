export function formatStudentId(value) {
    const digits = String(value ?? "").replace(/\D/g, "").slice(0, 8);
    if (digits.length < 2) return digits;
    return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

export function isValidStudentId(value) {
    return /^\d{2}-\d{6}$/.test(String(value ?? "").trim());
}
