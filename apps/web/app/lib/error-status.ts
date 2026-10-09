/** The HTTP status an error boundary reports: an error response's own status (a thrown `data(..., { status })`), 500 for anything else. */
export function errorStatus(error: unknown): number {
  if (typeof error === "object" && error !== null && "status" in error && typeof (error as { status: unknown }).status === "number") {
    const status = (error as { status: number }).status;
    if (Number.isInteger(status) && status >= 400 && status <= 599) return status;
  }
  return 500;
}
