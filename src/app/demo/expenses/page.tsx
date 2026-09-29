export const metadata = { title: { absolute: "Sign in - Contoso Expenses" } };
export default function Signin() {
  return (
    <main id="main"><h1>Sign in</h1>
      <form action="/demo/expenses/claims" method="get">
        <p><label>Work email <input name="email" type="email" autoComplete="username" /></label></p>
        <p><label>Password <input name="password" type="password" autoComplete="current-password" /></label></p>
        <p><button type="submit">Sign in</button></p>
      </form>
    </main>
  );
}
