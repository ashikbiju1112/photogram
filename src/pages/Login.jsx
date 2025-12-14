import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function Login() {
  const navigate = useNavigate();

  useEffect(() => {
    // 🔐 If already logged in, go to chat
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        navigate("/chat", { replace: true });
      }
    });
  }, []);

  const loginWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + "/#/auth",
      },
    });
  };

  return (
    <div className="login">
      <button onClick={loginWithGoogle}>
        Continue with Google
      </button>
    </div>
  );
}
