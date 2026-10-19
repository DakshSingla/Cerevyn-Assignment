const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "" : "http://localhost:3001");

export async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
  } catch (error) {
    throw new Error(`Cannot reach the backend at ${API_BASE}. Check that the API is running. ${error.message}`);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`The backend returned an invalid response (${response.status}).`);
  }
  if (!response.ok) {
    const message = typeof body.error === "string" ? body.error : body.error?.message;
    throw new Error(message || `Request failed (${response.status}).`);
  }
  return body;
}

export function formatMoney(paise) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2
  }).format(paise / 100);
}

export function formatDate(value, includeTime = true) {
  if (!value) return "No activity yet";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" } : {})
  }).format(parsed);
}
