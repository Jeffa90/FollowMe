export const metadata = { title: { absolute: "New claim - Contoso Expenses" } };
export default function NewClaim() {
  return (
    <main id="main"><h1>New claim</h1>
      <form action="/demo/expenses/done" method="get">
        <p><label>Description <input name="description" /></label></p>
        <p><label>Amount <input name="amount" type="number" step="0.01" /></label></p>
        <p><label>Category <select name="category"><option>Travel</option><option>Meals</option><option>Equipment</option></select></label></p>
        <p><label>Payment card number <input name="card" autoComplete="cc-number" /></label></p>
        <p><button type="submit">Submit claim</button></p>
      </form>
    </main>
  );
}
