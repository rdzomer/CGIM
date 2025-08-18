/* src/pages/LoginPage.tsx */
import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router-dom";

const LoginPage: React.FC = () => {
  const { signIn, loading, user } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Redireciona quando a sessão estiver realmente pronta
  useEffect(() => {
    if (!loading && user) {
      navigate("/");
    }
  }, [loading, user, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setErro(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), senha);
      // não navegar aqui; deixa o efeito acima redirecionar
    } catch (err: any) {
      console.error(err);
      setErro("Não foi possível entrar. Verifique e tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white border shadow-sm p-6">
        <h1 className="text-2xl font-semibold text-slate-800">CGIM — Gestão de Pleitos</h1>
        <p className="text-slate-500 text-sm mb-6">Acesso restrito</p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">E-mail</label>
            <input
              type="email"
              className="w-full rounded-xl border px-3 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Senha</label>
            <input
              type="password"
              className="w-full rounded-xl border px-3 py-2"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {erro && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {erro}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || loading}
            className="w-full rounded-xl bg-indigo-600 text-white py-2 disabled:opacity-50"
          >
            {submitting || loading ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <div className="mt-6 text-xs text-slate-400 text-center">
          © {new Date().getFullYear()} CGIM
        </div>
      </div>
    </div>
  );
};

export default LoginPage;

