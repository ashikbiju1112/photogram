import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import "./login.css";

export default function Login() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        navigate("/chat", { replace: true });
      }
    });
  }, [navigate]);

  async function handleLogin() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
    });
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="app-title">📸 Photogram</h1>
        <p className="app-subtitle">
          Chat privately. Share moments. Call instantly.
        </p>

        <button className="google-btn" onClick={handleLogin}>
          <img
            src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
            alt="Google"
          />
          Continue with Google
        </button>

        <p className="login-footer">
          End-to-end encrypted chats 🔒
        </p>
      </div>
    </div>
  );
}
