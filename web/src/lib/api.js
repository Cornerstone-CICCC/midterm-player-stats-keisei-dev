const API_BASE = import.meta.env.PUBLIC_API_BASE_URL || "http://localhost:3000";

export function apiUrl(path, params) {
  const url = new URL(path, API_BASE);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

export async function apiGet(path, params) {
  const res = await fetch(apiUrl(path, params));
  if (!res.ok) {
    throw new Error(`API error ${res.status}`);
  }
  return res.json();
}

export { API_BASE };
