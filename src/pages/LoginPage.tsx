/* src/pages/LoginPage.tsx */
import React, { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router-dom";

const LoginPage: React.FC = () => {
  const { signIn, loading } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), senha);
      navigate("/");
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
        <div className="mb-6 text-center">
          <div className="text-2xl font-semibold">CGIM — Gestão de Pleitos</div>
          <div className="text-sm text-slate-500">Acesso restrito</div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">E-mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full border rounded-xl px-4 py-2.5 outline-none focus:ring"
              placeholder="usuario@org.br"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Senha</label>
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
              className="w-full border rounded-xl px-4 py-2.5 outline-none focus:ring"
              placeholder="••••••••"
            />
          </div>

          {erro && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              {erro}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || loading}
            className="w-full rounded-xl bg-indigo-600 text-white px-4 py-2.5 hover:bg-indigo-700 disabled:opacity-60"
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
