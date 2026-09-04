import { useState } from "react";
import { FIELD_CLASS, PRIMARY_BUTTON_CLASS } from "../components/ui.js";
import { useNavigate } from "react-router-dom";
import { useLogin } from "../api/auth.js";

export function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useLogin();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login.mutateAsync(password);
      navigate("/");
    } catch {
      setError("Incorrect password");
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 pt-24 dark:text-slate-100">
      <h1 className="text-2xl font-semibold">Log in</h1>
      <form onSubmit={handleSubmit} className="flex w-full max-w-xs flex-col gap-3">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className={FIELD_CLASS}
        />
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={login.isPending}
          className={PRIMARY_BUTTON_CLASS}
        >
          Log in
        </button>
      </form>
    </div>
  );
}
