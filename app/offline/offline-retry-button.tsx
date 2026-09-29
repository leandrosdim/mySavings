"use client";

export function OfflineRetryButton() {
  return (
    <button
      type="button"
      onClick={() => location.reload()}
      style={{
        minHeight: "2.75rem",
        padding: "0.6rem 1.1rem",
        borderRadius: "0.6rem",
        backgroundColor: "var(--accent)",
        color: "white",
        fontWeight: 600,
        fontSize: "0.95rem",
        border: "none",
        cursor: "pointer",
      }}
    >
      Δοκίμασε ξανά
    </button>
  );
}