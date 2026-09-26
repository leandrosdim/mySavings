import { verifySession } from "@/lib/auth/dal";

export const metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  const session = await verifySession();
  return (
    <main
      style={{
        maxWidth: "30rem",
        margin: "0 auto",
        padding: "1.25rem 1rem 3rem",
        display: "flex",
        flexDirection: "column",
        gap: "1.2rem",
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
        <h1
          style={{
            fontSize: "1.4rem",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          Dashboard
        </h1>
        <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
          Signed in as {session.email}
        </p>
      </header>

      <div
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "0.8rem",
          padding: "1rem 1.05rem",
          fontSize: "0.9rem",
          color: "var(--muted)",
        }}
      >
        Private workspace placeholder. Account, expenses and income screens
        arrive in later steps.
      </div>

      <form action="/api/auth/logout" method="POST">
        <button
          type="submit"
          style={{
            minHeight: "2.75rem",
            padding: "0.55rem 1.1rem",
            borderRadius: "0.6rem",
            backgroundColor: "var(--card)",
            color: "var(--fg)",
            fontWeight: 600,
            fontSize: "0.95rem",
            border: "1px solid var(--border)",
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </form>
    </main>
  );
}