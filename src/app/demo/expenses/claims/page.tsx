export const metadata = { title: { absolute: "My claims - Contoso Expenses" } };
export default function Claims() {
  return (
    <main id="main"><h1>My claims</h1>
      <p>Signed in as <strong data-testid="user-email">jane.doe@contoso.example</strong></p>
      <table style={{ background: "#fff", width: "100%" }}><thead><tr><th align="left">Description</th><th align="left">Status</th></tr></thead><tbody><tr><td>Train ticket</td><td>Approved</td></tr></tbody></table>
      <p><a href="/demo/expenses/new" role="button" style={{ display: "inline-block", padding: "8px 14px", background: "#0f766e", color: "#fff", borderRadius: 6, textDecoration: "none" }}>New claim</a></p>
    </main>
  );
}
