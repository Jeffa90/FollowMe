// A tiny fictional expenses application used to demonstrate and test process capture. Not part of the product.
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "#f1f5f9", minHeight: "100vh", color: "#0f172a" }}>
      <header style={{ background: "#0f766e", color: "#fff", padding: "14px 24px", fontWeight: 800, fontSize: 20 }}>Contoso Expenses <span style={{ fontWeight: 400, fontSize: 13 }}>(demo application for capture)</span></header>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>{children}</div>
    </div>
  );
}
