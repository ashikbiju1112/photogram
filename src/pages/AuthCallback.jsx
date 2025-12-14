import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    async function handleAuth() {
      // ⬇️ This processes the hash token
      const { error } = await supabase.auth.getSession();

      if (error) {
        console.error(error);
        return;
      }

      // ⬇️ IMPORTANT: remove token from URL
      window.location.hash = "";

      // ⬇️ Go to chat cleanly
      navigate("/chat", { replace: true });
    }

    handleAuth();
  }, [navigate]);

  return <div>Signing you in…</div>;
}
